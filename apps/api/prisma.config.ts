import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Fallback lets `prisma generate` run in CI/Docker builds without a DB.
    url: process.env.DATABASE_URL ?? "postgresql://kw:kw@localhost:5432/kw",
  },
});
