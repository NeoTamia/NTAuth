DROP INDEX "jobs_available_idx";
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_attempts_check";
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_max_attempts_check";
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_status_check";
