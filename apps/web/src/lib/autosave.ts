/**
 * Autosave for one page's Y.Doc. Plain TypeScript (no React), so it's testable with
 * fake timers and fake network calls.
 *
 *   edit ──► wait for a pause (debounce) ──► PUT full state + markdown + baseVersion
 *                                              │
 *            200 → remember the new version ◄──┤
 *            409 → GET server state, MERGE it into our Y.Doc (CRDT: no lost edits), save again
 *            5xx / network → retry with backoff
 *            403 / 404 / 401 → stop, tell the user (retrying won't help)
 */
import type { DocumentContent, SaveContentBody } from "@kw/shared";
import * as Y from "yjs";
import { ApiError, NotLoggedInError } from "./api";
import { fromBase64, toBase64 } from "./base64";

export type SaveStatus =
  | { kind: "saved" }
  | { kind: "pending" } // edits not sent yet
  | { kind: "saving" }
  | { kind: "retrying" } // a save failed for a reason that may pass (network, 5xx)
  | { kind: "failed"; message: string }; // stopped: needs the user

export interface AutosaveOptions {
  ydoc: Y.Doc;
  /** The version the loaded state came from. */
  version: number;
  getMarkdown: () => string;
  save: (body: SaveContentBody) => Promise<{ version: number }>;
  load: () => Promise<DocumentContent>;
  onStatus: (status: SaveStatus) => void;
  /** Save this long after the last edit. */
  debounceMs?: number;
  /** ...but never wait longer than this while someone keeps typing. */
  maxWaitMs?: number;
}

/** Marks Y.Doc changes that came FROM the server (merges), as opposed to the user typing. */
export const SERVER_ORIGIN = Symbol("server");

const MAX_CONFLICT_RETRIES = 3;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

export class Autosave {
  private version: number;
  private dirty = false;
  private firstDirtyAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private failures = 0;
  private stopped = false;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;

  constructor(private readonly opts: AutosaveOptions) {
    this.version = opts.version;
    this.debounceMs = opts.debounceMs ?? 1_000;
    this.maxWaitMs = opts.maxWaitMs ?? 10_000;
    opts.ydoc.on("update", this.onUpdate);
  }

  /** True while there are edits the server doesn't have yet (used to warn before closing the tab). */
  get hasUnsavedChanges(): boolean {
    return this.dirty || this.inFlight !== undefined;
  }

  /** Save now if anything is pending, and wait for it. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.inFlight) await this.inFlight;
    if (this.dirty) await this.run();
  }

  /** Stop listening and send whatever is pending (e.g. when leaving the page). */
  close(): Promise<void> {
    this.opts.ydoc.off("update", this.onUpdate);
    return this.flush().finally(() => {
      this.stopped = true;
      clearTimeout(this.timer);
    });
  }

  private onUpdate = (_update: Uint8Array, origin: unknown) => {
    // Merges from the server are already saved there; run() re-saves the merged result itself.
    if (origin === SERVER_ORIGIN || this.stopped) return;
    if (!this.dirty) this.firstDirtyAt = Date.now();
    this.dirty = true;
    // While backing off after a failure, keep the retry timer: typing offline must not
    // turn the backoff into a save attempt on every keystroke.
    if (this.failures > 0) return;
    if (!this.inFlight) this.setStatus({ kind: "pending" });
    this.schedule();
  };

  private schedule(delay = this.debounceMs) {
    clearTimeout(this.timer);
    // Debounce, but cap the wait so a long typing session still gets saved regularly.
    const untilMax = Math.max(0, this.firstDirtyAt + this.maxWaitMs - Date.now());
    this.timer = setTimeout(() => void this.run(), Math.min(delay, untilMax));
  }

  /** One save at a time. Edits made during a save are picked up by a follow-up save. */
  private run(): Promise<void> {
    if (this.inFlight || this.stopped) return this.inFlight ?? Promise.resolve();
    this.inFlight = this.saveOnce().finally(() => {
      this.inFlight = undefined;
      if (this.dirty && !this.stopped && this.failures === 0) this.schedule(0);
    });
    return this.inFlight;
  }

  private async saveOnce(conflictRetries = 0): Promise<void> {
    this.dirty = false;
    this.setStatus({ kind: "saving" });
    try {
      // Full state, not just the latest change: the server stores one snapshot per page.
      const state = toBase64(Y.encodeStateAsUpdate(this.opts.ydoc));
      const { version } = await this.opts.save({ state, markdown: this.opts.getMarkdown(), baseVersion: this.version });
      this.version = version;
      this.failures = 0;
      this.setStatus(this.dirty ? { kind: "pending" } : { kind: "saved" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && conflictRetries < MAX_CONFLICT_RETRIES) {
        // Someone (another tab) saved first. Pull their state and merge: Yjs combines
        // both sets of edits, then we save the combined result on top of their version.
        await this.mergeFromServer();
        return this.saveOnce(conflictRetries + 1);
      }
      this.dirty = true; // our edits still aren't on the server
      this.handleFailure(err);
    }
  }

  private async mergeFromServer() {
    const server = await this.opts.load();
    if (server.state) Y.applyUpdate(this.opts.ydoc, fromBase64(server.state), SERVER_ORIGIN);
    this.version = server.version;
  }

  private handleFailure(err: unknown) {
    const permanent =
      err instanceof NotLoggedInError ? "Your session ended. Log in again to keep saving."
      : err instanceof ApiError && err.status === 403 ? "You no longer have permission to edit this page."
      : err instanceof ApiError && err.status === 404 ? "This page was deleted."
      : err instanceof ApiError && err.status === 409 ? "This page keeps changing elsewhere. Reload to continue."
      : err instanceof ApiError && err.status >= 400 && err.status < 500 ? "Couldn't save this change."
      : null;
    if (permanent) {
      this.stopped = true;
      this.setStatus({ kind: "failed", message: permanent });
      return;
    }
    // Network error or 5xx: probably temporary. Back off (2 s, 5 s, 15 s… up to 60 s), then retry.
    const delay = RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length - 1)]!;
    this.failures += 1;
    this.setStatus({ kind: "retrying" });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  private setStatus(status: SaveStatus) {
    this.opts.onStatus(status);
  }
}
