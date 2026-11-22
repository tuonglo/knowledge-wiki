/**
 * Events other services react to. Today: `doc.saved` → the Python indexer re-embeds the page.
 *
 * Redis Streams (not pub/sub): messages are stored, so an indexer that's down or busy
 * catches up later instead of missing saves. Consumer groups (Phase 4) let several
 * workers share the stream, each message handled once.
 */
import { DOC_SAVED_STREAM, type DocSavedEvent } from "@kw/shared";
import type { Redis } from "ioredis";

export interface DocEvents {
  docSaved(event: DocSavedEvent): Promise<void>;
}

/** Keep the stream from growing forever. `~` lets Redis trim in cheap, approximate batches. */
const STREAM_MAX_LENGTH = 100_000;

export function createRedisDocEvents(redis: Redis): DocEvents {
  return {
    async docSaved({ documentId, workspaceId, version }) {
      await redis.xadd(
        DOC_SAVED_STREAM,
        "MAXLEN",
        "~",
        STREAM_MAX_LENGTH,
        "*", // let Redis assign the message id (timestamp-sequence)
        "documentId",
        documentId,
        "workspaceId",
        workspaceId,
        "version",
        String(version),
      );
    },
  };
}

/** For tests and tools that don't need events. */
export const noDocEvents: DocEvents = { docSaved: async () => {} };
