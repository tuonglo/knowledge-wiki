/**
 * Test database helpers. Tests use a separate `kw_test` database on the same
 * Postgres server as dev, so running tests never touches your dev data.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

export function testDatabaseUrl(): string {
  try {
    process.loadEnvFile(new URL("../../../../.env", import.meta.url));
  } catch {
    // no .env (CI): DATABASE_URL comes from the environment
  }
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://kw:kw@localhost:5432/kw");
  url.pathname = "/kw_test";
  return url.toString();
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl() }) });
}

/** Empty every table (keeps the schema). Call in beforeEach for isolated tests. */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}
