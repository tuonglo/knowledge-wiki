import { DOC_SAVED_STREAM, DocSavedEvent } from "@kw/shared";
import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createRedisDocEvents } from "./events.js";

/** Real Redis, but logical database 15, so tests never touch dev data (which lives in db 0). */
function testRedisUrl(): string {
  try {
    process.loadEnvFile(new URL("../../../.env", import.meta.url));
  } catch {
    // no .env (CI): REDIS_URL comes from the environment
  }
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  url.pathname = "/15";
  return url.toString();
}

const redis = new Redis(testRedisUrl(), { maxRetriesPerRequest: 1 });
afterAll(() => redis.quit());
beforeEach(() => redis.flushdb());

describe("createRedisDocEvents", () => {
  it("appends doc.saved messages the indexer can read back", async () => {
    const events = createRedisDocEvents(redis);
    await events.docSaved({ documentId: "d1", workspaceId: "w1", version: 3 });
    await events.docSaved({ documentId: "d1", workspaceId: "w1", version: 4 });

    const entries = await redis.xrange(DOC_SAVED_STREAM, "-", "+");
    expect(entries).toHaveLength(2);

    // Stream fields arrive as a flat [k1, v1, k2, v2] list of strings. Parse them the way
    // a consumer would, with the shared schema (version is a string on the wire).
    const [, fields] = entries[0]!;
    const raw = Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, i) => [fields[2 * i], fields[2 * i + 1]]));
    expect(DocSavedEvent.parse({ ...raw, version: Number(raw.version) })).toEqual({
      documentId: "d1",
      workspaceId: "w1",
      version: 3,
    });
  });
});
