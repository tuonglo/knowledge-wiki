import type { DocumentContent, SaveContentBody } from "@kw/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { ApiError, NotLoggedInError } from "./api";
import { Autosave, type SaveStatus } from "./autosave";
import { fromBase64, toBase64 } from "./base64";

/**
 * A fake server holding one page, with the same version rule as the real API:
 * a save must name the current version, or it gets 409.
 */
function fakeServer(initial: Y.Doc = new Y.Doc(), version = 0) {
  const server = {
    state: toBase64(Y.encodeStateAsUpdate(initial)),
    version,
    saves: [] as SaveContentBody[],
    /** Make the next N saves fail with this error. */
    failNext: [] as unknown[],
    save: vi.fn(async (body: SaveContentBody) => {
      server.saves.push(body);
      const failure = server.failNext.shift();
      if (failure) throw failure;
      if (body.baseVersion !== server.version) throw new ApiError(409, "version_conflict");
      server.state = body.state;
      server.version += 1;
      return { version: server.version };
    }),
    load: vi.fn(async (): Promise<DocumentContent> => ({ state: server.state, markdown: "", version: server.version })),
    /** What the server currently stores, as text. */
    text() {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, fromBase64(server.state));
      return doc.getText("t").toString();
    },
  };
  return server;
}

function setup(server = fakeServer(), opts: { version?: number; ydoc?: Y.Doc } = {}) {
  const ydoc = opts.ydoc ?? new Y.Doc();
  const statuses: SaveStatus["kind"][] = [];
  const autosave = new Autosave({
    ydoc,
    version: opts.version ?? server.version,
    getMarkdown: () => ydoc.getText("t").toString(),
    save: server.save,
    load: server.load,
    onStatus: (s) => statuses.push(s.kind),
    debounceMs: 1_000,
    maxWaitMs: 10_000,
  });
  const type = (text: string) => {
    const t = ydoc.getText("t");
    t.insert(t.length, text);
  };
  const lastStatus = () => statuses.at(-1);
  return { ydoc, autosave, type, statuses, lastStatus, server };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Autosave", () => {
  it("waits for a pause, then saves once for many edits", async () => {
    const { type, server, lastStatus } = setup();
    type("H");
    type("i");
    expect(lastStatus()).toBe("pending");
    await vi.advanceTimersByTimeAsync(999);
    expect(server.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(server.save).toHaveBeenCalledTimes(1);
    expect(server.text()).toBe("Hi");
    expect(server.saves[0]).toMatchObject({ markdown: "Hi", baseVersion: 0 });
    expect(lastStatus()).toBe("saved");
  });

  it("still saves during non-stop typing (max wait)", async () => {
    const { type, server } = setup();
    for (let i = 0; i < 12; i++) {
      type("x");
      await vi.advanceTimersByTimeAsync(900); // never pauses for a full second
    }
    expect(server.save).toHaveBeenCalledTimes(1); // forced at the 10 s mark
  });

  it("uses the new version as the base for the next save", async () => {
    const { type, server } = setup();
    type("a");
    await vi.advanceTimersByTimeAsync(1_000);
    type("b");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.saves.map((s) => s.baseVersion)).toEqual([0, 1]);
    expect(server.text()).toBe("ab");
  });

  it("edits made during a save go out in a follow-up save", async () => {
    const server = fakeServer();
    let release!: () => void;
    const original = server.save.getMockImplementation()!;
    server.save.mockImplementationOnce(async (body) => {
      await new Promise<void>((r) => (release = r));
      return original(body);
    });
    const { type } = setup(server);
    type("first");
    await vi.advanceTimersByTimeAsync(1_000); // save #1 starts and hangs
    type(" second");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.save).toHaveBeenCalledTimes(1); // never two at once
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.save).toHaveBeenCalledTimes(2);
    expect(server.text()).toBe("first second");
  });

  it("on 409, merges the other tab's edits instead of losing either side", async () => {
    // Both tabs start from the same saved page.
    const base = new Y.Doc();
    base.getText("t").insert(0, "base");
    const server = fakeServer(base, 1);
    const tabA = new Y.Doc();
    const tabB = new Y.Doc();
    Y.applyUpdate(tabA, Y.encodeStateAsUpdate(base));
    Y.applyUpdate(tabB, Y.encodeStateAsUpdate(base));

    const a = setup(server, { ydoc: tabA });
    const b = setup(server, { ydoc: tabB });
    a.type(" +A");
    b.type(" +B");
    await vi.advanceTimersByTimeAsync(1_000);

    // One tab hit 409, merged, and saved again: the server has BOTH edits.
    expect(server.load).toHaveBeenCalledTimes(1);
    expect(server.text()).toContain("+A");
    expect(server.text()).toContain("+B");
    expect(server.version).toBe(3);
    expect(a.lastStatus()).toBe("saved");
    expect(b.lastStatus()).toBe("saved");
  });

  it("retries network errors with backoff, without hammering while you type", async () => {
    const server = fakeServer();
    server.failNext = [new TypeError("Failed to fetch"), new TypeError("Failed to fetch")];
    const { type, lastStatus } = setup(server);
    type("a");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lastStatus()).toBe("retrying");

    type("b"); // typing while offline doesn't trigger an early attempt
    await vi.advanceTimersByTimeAsync(1_999);
    expect(server.save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1); // 2 s backoff → fails again
    expect(server.save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000); // 5 s backoff → succeeds
    expect(server.save).toHaveBeenCalledTimes(3);
    expect(server.text()).toBe("ab");
    expect(lastStatus()).toBe("saved");
  });

  it.each([
    [new ApiError(403, "forbidden"), "permission"],
    [new ApiError(404, "document_not_found"), "deleted"],
    [new NotLoggedInError(), "Log in"],
  ])("stops on %s and says why", async (error, words) => {
    const server = fakeServer();
    server.failNext = [error];
    const statuses: SaveStatus[] = [];
    const ydoc = new Y.Doc();
    new Autosave({
      ydoc,
      version: 0,
      getMarkdown: () => "",
      save: server.save,
      load: server.load,
      onStatus: (s) => statuses.push(s),
    });
    ydoc.getText("t").insert(0, "x");
    await vi.advanceTimersByTimeAsync(1_000);
    const last = statuses.at(-1)!;
    expect(last.kind).toBe("failed");
    expect(last.kind === "failed" && last.message).toContain(words);
    ydoc.getText("t").insert(0, "y");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.save).toHaveBeenCalledTimes(1); // no retries
  });

  it("close() saves pending edits right away, then stops listening", async () => {
    const { type, server, autosave } = setup();
    type("unsaved");
    expect(autosave.hasUnsavedChanges).toBe(true);
    await autosave.close();
    expect(server.text()).toBe("unsaved");
    type(" more");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.save).toHaveBeenCalledTimes(1);
  });

  it("does nothing when nothing changed", async () => {
    const { server, autosave } = setup();
    await vi.advanceTimersByTimeAsync(30_000);
    await autosave.close();
    expect(server.save).not.toHaveBeenCalled();
  });
});
