ALTER TABLE "user" ADD COLUMN "status" varchar(16) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "user_status_idx" ON "user" USING btree ("status");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_status_check" CHECK ("user"."status" in ('active', 'suspended', 'deactivated', 'deleted'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_deleted_at_check" CHECK (("user"."status" = 'deleted' and "user"."deleted_at" is not null) or ("user"."status" <> 'deleted' and "user"."deleted_at" is null));