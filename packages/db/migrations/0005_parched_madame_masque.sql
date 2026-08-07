ALTER TABLE "jobs" ADD COLUMN "deduplication_key" varchar(160);--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_deduplication_key_unique" ON "jobs" USING btree ("deduplication_key");