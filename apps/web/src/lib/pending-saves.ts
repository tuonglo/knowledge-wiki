/**
 * Things that still need to reach the server (e.g. an editor's unsaved edits).
 * Logout waits for them first: once the session ends, a save can't authenticate.
 */
type Flush = () => Promise<void>;

const flushes = new Set<Flush>();

/** Register a flush; returns the unregister function (call it on unmount). */
export function registerPendingSave(flush: Flush): () => void {
  flushes.add(flush);
  return () => flushes.delete(flush);
}

/** Run every registered flush. Never throws: a failed save mustn't block logging out. */
export async function flushPendingSaves(): Promise<void> {
  await Promise.allSettled([...flushes].map((flush) => flush()));
}
