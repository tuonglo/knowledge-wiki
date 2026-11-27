import { Redis } from "ioredis";

/** Real Redis, but logical database 15, so tests never touch dev data (which lives in db 0). */
export function testRedisUrl(): string {
  try {
    process.loadEnvFile(new URL("../../../../.env", import.meta.url));
  } catch {
    // no .env (CI): REDIS_URL comes from the environment
  }
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  url.pathname = "/15";
  return url.toString();
}

export function createTestRedis(): Redis {
  return new Redis(testRedisUrl(), { maxRetriesPerRequest: 1 });
}
