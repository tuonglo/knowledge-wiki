-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "content" BYTEA,
ADD COLUMN     "markdown" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;
