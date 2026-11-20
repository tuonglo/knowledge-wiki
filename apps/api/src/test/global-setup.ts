/**
 * Runs once before the whole test suite: make sure `kw_test` exists and has the
 * latest migrations. Needs Postgres running (`pnpm db:up`).
 */
import { execSync } from "node:child_process";
import pg from "pg";
import { testDatabaseUrl } from "./db.js";

export default async function setup() {
  const testUrl = testDatabaseUrl();
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres"; // connect to the default DB to create the test one

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(`Can't reach Postgres for tests (${adminUrl.host}). Is it running? Try: pnpm db:up`, {
      cause: err,
    });
  }
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'kw_test'");
  if (exists.rowCount === 0) await admin.query("CREATE DATABASE kw_test");
  await admin.end();

  execSync("prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "pipe",
  });
}
