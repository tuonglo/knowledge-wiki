import { defineConfig } from "prisma/config";

// Prisma 7 doesn't auto-load .env. Load the repo-root one if it exists
// (it won't in CI/Docker, where real env vars are set instead).
try {
  process.loadEnvFile("../../.env");
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Fallback lets `prisma generate` run in CI/Docker builds without a DB.
    url: process.env.DATABASE_URL ?? "postgresql://kw:kw@localhost:5432/kw",
  },
});
