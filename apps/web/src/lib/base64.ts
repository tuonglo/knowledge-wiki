/** Bytes ↔ base64 in the browser (Yjs state travels as base64 inside JSON). */

export function toBase64(bytes: Uint8Array): string {
  // String.fromCharCode(...bytes) on a big array overflows the call stack, so go in chunks.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
