import * as Y from "yjs";

/**
 * Does this look like a Yjs update? Applies it to a throwaway doc: garbage, empty and
 * truncated input throw. A sanity check, not a proof (rare garbage could still decode),
 * but it stops a buggy or hostile client from saving bytes that crash every reader.
 */
export function isValidYjsUpdate(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  try {
    Y.applyUpdate(new Y.Doc(), bytes);
    return true;
  } catch {
    return false;
  }
}
