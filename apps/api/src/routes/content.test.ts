import type { DocSavedEvent } from "@kw/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { DocEvents } from "../events.js";
import { bearerFor, createTestApp } from "../test/app.js";
import { createTestPrisma, resetDb } from "../test/db.js";
import { createTestTokens } from "../test/tokens.js";

const prisma = createTestPrisma();
let app: Express;
let as: (userId: string) => Promise<string>;

/** Records published events; set `fail` to simulate Redis being down. */
const events: DocEvents & { published: DocSavedEvent[]; fail: boolean } = {
  published: [],
  fail: false,
  docSaved: async (e) => {
    if (events.fail) throw new Error("redis down");
    events.published.push(e);
  },
};

beforeAll(async () => {
  const tokens = await createTestTokens();
  app = createTestApp(prisma, tokens, events);
  as = bearerFor(tokens);
});
afterAll(() => prisma.$disconnect());

/** A real Yjs update containing `text`, base64-encoded like the editor will send it. */
function yState(text: string): string {
  const doc = new Y.Doc();
  doc.getText("body").insert(0, text);
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

/** Decode a saved state back into its text, to prove the bytes round-trip intact. */
function textOf(state: string): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(state, "base64"));
  return doc.getText("body").toString();
}

/*  Acme: olivia OWNER, vic VIEWER. gus: guest with EDITOR on Projects (→ Roadmap inherits). xena: outsider. */
let olivia: string, vic: string, gus: string, xena: string;
let ws: string, projects: string, roadmap: string;

beforeEach(async () => {
  await resetDb(prisma);
  events.published = [];
  events.fail = false;
  const user = async (name: string) => (await prisma.user.create({ data: { email: `${name}@example.com` } })).id;
  [olivia, vic, gus, xena] = (await Promise.all(["olivia", "vic", "gus", "xena"].map(user))) as [string, string, string, string];
  ws = (await prisma.workspace.create({ data: { name: "Acme" } })).id;
  await prisma.membership.createMany({
    data: [
      { userId: olivia, workspaceId: ws, role: "OWNER" },
      { userId: vic, workspaceId: ws, role: "VIEWER" },
    ],
  });
  projects = (await prisma.document.create({ data: { title: "Projects", workspaceId: ws, createdById: olivia } })).id;
  roadmap = (await prisma.document.create({ data: { title: "Roadmap", workspaceId: ws, parentId: projects, createdById: olivia } })).id;
  await prisma.documentPermission.create({ data: { userId: gus, documentId: projects, role: "EDITOR" } });
});

const getContent = async (userId: string, docId = projects) =>
  request(app).get(`/documents/${docId}/content`).set("Authorization", await as(userId));

const save = async (userId: string, body: object, docId = projects) =>
  request(app).put(`/documents/${docId}/content`).set("Authorization", await as(userId)).send(body);

describe("GET /documents/:id/content", () => {
  it("a never-saved page is empty at version 0", async () => {
    const res = await getContent(olivia);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: null, markdown: "", version: 0 });
  });

  it("viewers can read; outsiders get 404", async () => {
    expect((await getContent(vic)).status).toBe(200);
    expect((await getContent(xena)).status).toBe(404);
  });
});

describe("PUT /documents/:id/content", () => {
  it("saves, bumps the version, and reads back the same bytes", async () => {
    const res = await save(olivia, { state: yState("Hello"), markdown: "Hello", baseVersion: 0 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: 1 });

    const read = await getContent(olivia);
    expect(read.body).toMatchObject({ markdown: "Hello", version: 1 });
    expect(textOf(read.body.state)).toBe("Hello");
  });

  it("successive saves each move the version on", async () => {
    await save(olivia, { state: yState("a"), markdown: "a", baseVersion: 0 });
    const res = await save(olivia, { state: yState("ab"), markdown: "ab", baseVersion: 1 });
    expect(res.body).toEqual({ version: 2 });
  });

  it("rejects a stale save with 409 and keeps the newer content", async () => {
    await save(olivia, { state: yState("newer"), markdown: "newer", baseVersion: 0 });
    const stale = await save(olivia, { state: yState("older"), markdown: "older", baseVersion: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ error: "version_conflict", details: { currentVersion: 1 } });
    expect((await getContent(olivia)).body.markdown).toBe("newer");
  });

  it("RACE: two saves from the same version → exactly one wins", async () => {
    const results = await Promise.all(
      ["first", "second", "third"].map((text) => save(olivia, { state: yState(text), markdown: text, baseVersion: 0 })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    const content = (await getContent(olivia)).body;
    expect(content.version).toBe(1);
    // The stored content is the winner's, intact: not a mix of two saves.
    const winner = results.find((r) => r.status === 200)!;
    expect(winner.body).toEqual({ version: 1 });
    expect(textOf(content.state)).toBe(content.markdown);
  });

  it("editing is inherited: a guest with EDITOR on the parent can save the child", async () => {
    const res = await save(gus, { state: yState("x"), markdown: "x", baseVersion: 0 }, roadmap);
    expect(res.status).toBe(200);
  });

  it("viewers get 403 and outsiders 404; nothing is saved", async () => {
    expect((await save(vic, { state: yState("x"), markdown: "x", baseVersion: 0 })).status).toBe(403);
    expect((await save(xena, { state: yState("x"), markdown: "x", baseVersion: 0 })).status).toBe(404);
    expect((await getContent(olivia)).body.version).toBe(0);
  });

  describe("validation", () => {
    it("rejects bytes that aren't a Yjs update (400 invalid_state)", async () => {
      const res = await save(olivia, { state: Buffer.from("not yjs").toString("base64"), markdown: "", baseVersion: 0 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_state");
    });

    it.each([
      ["not base64", { state: "%%%", markdown: "", baseVersion: 0 }],
      ["empty state", { state: "", markdown: "", baseVersion: 0 }],
      ["missing baseVersion", { state: yState("x"), markdown: "" }],
      ["negative baseVersion", { state: yState("x"), markdown: "", baseVersion: -1 }],
      ["markdown too long", { state: yState("x"), markdown: "a".repeat(1_000_001), baseVersion: 0 }],
    ])("rejects %s (400 invalid_body)", async (_name, body) => {
      const res = await save(olivia, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_body");
    });

    it("rejects a body over the size limit with 413", async () => {
      const res = await save(olivia, { state: yState("x"), markdown: "a".repeat(6_000_000), baseVersion: 0 });
      expect(res.status).toBe(413);
      expect(res.body).toEqual({ error: "payload_too_large" });
    });
  });

  describe("doc.saved event", () => {
    it("is published once per successful save, with the new version", async () => {
      await save(olivia, { state: yState("x"), markdown: "x", baseVersion: 0 });
      expect(events.published).toEqual([{ documentId: projects, workspaceId: ws, version: 1 }]);
    });

    it("is NOT published when the save fails", async () => {
      await save(vic, { state: yState("x"), markdown: "x", baseVersion: 0 }); // 403
      await save(olivia, { state: yState("x"), markdown: "x", baseVersion: 5 }); // 409
      expect(events.published).toEqual([]);
    });

    it("a Redis failure doesn't fail the save (it's already committed)", async () => {
      events.fail = true;
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await save(olivia, { state: yState("x"), markdown: "x", baseVersion: 0 });
      expect(res.status).toBe(200);
      expect((await getContent(olivia)).body.version).toBe(1);
      expect(quiet).toHaveBeenCalled();
      quiet.mockRestore();
    });
  });
});

describe("content stays out of the page list", () => {
  it("GET /workspaces/:id/documents doesn't send content or markdown", async () => {
    await save(olivia, { state: yState("big"), markdown: "big", baseVersion: 0 });
    const res = await request(app).get(`/workspaces/${ws}/documents`).set("Authorization", await as(olivia));
    expect(Object.keys(res.body[0]).sort()).toEqual(["id", "parentId", "role", "title"]);
  });
});
