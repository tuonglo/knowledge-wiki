import { PrismaPg } from "@prisma/adapter-pg";
import { Redis } from "ioredis";
import { createApp } from "./app.js";
import { env } from "./env.js";
import { PrismaClient } from "./generated/prisma/client.js";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});
const redis = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 });

const app = createApp({
  webOrigin: env.WEB_ORIGIN,
  checks: {
    postgres: () => prisma.$queryRaw`SELECT 1`,
    redis: () => redis.ping(),
  },
});

const server = app.listen(env.API_PORT, () => {
  console.log(`api listening on :${env.API_PORT}`);
});

async function shutdown() {
  server.close();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
