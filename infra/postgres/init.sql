-- Runs once on first container start. Prisma migrations also enable these,
-- but having them here means a fresh DB is usable before any migration.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
