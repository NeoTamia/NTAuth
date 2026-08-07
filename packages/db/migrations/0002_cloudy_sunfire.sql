CREATE INDEX "jobs_available_idx" ON "jobs" USING btree ("status","available_at");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_attempts_check" CHECK ("jobs"."attempts" >= 0);--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_max_attempts_check" CHECK ("jobs"."max_attempts" > 0);--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('available', 'running', 'completed', 'failed'));