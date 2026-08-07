DROP INDEX "jobs_deduplication_key_unique";
ALTER TABLE "jobs" DROP COLUMN "deduplication_key";
