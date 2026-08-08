CREATE TABLE "iam_catalog_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" varchar(63) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"identifier" varchar(256) NOT NULL,
	"description" varchar(500),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "iam_catalog_entries_kind_check" CHECK ("iam_catalog_entries"."kind" in ('action', 'resource')),
	CONSTRAINT "iam_catalog_entries_status_check" CHECK ("iam_catalog_entries"."status" in ('active', 'inactive')),
	CONSTRAINT "iam_catalog_entries_ownership_check" CHECK ("iam_catalog_entries"."identifier" like "iam_catalog_entries"."service" || ':%')
);
--> statement-breakpoint
CREATE TABLE "services" (
	"key" varchar(63) PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"owner_user_id" text NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_key_check" CHECK ("services"."key" ~ '^[a-z][a-z0-9-]{0,62}$'),
	CONSTRAINT "services_name_check" CHECK (length(trim("services"."name")) > 0),
	CONSTRAINT "services_status_check" CHECK ("services"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "iam_catalog_entries" ADD CONSTRAINT "iam_catalog_entries_service_services_key_fk" FOREIGN KEY ("service") REFERENCES "public"."services"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_catalog_entries" ADD CONSTRAINT "iam_catalog_entries_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "iam_catalog_entries_service_kind_identifier_unique" ON "iam_catalog_entries" USING btree ("service","kind","identifier");--> statement-breakpoint
CREATE INDEX "iam_catalog_entries_lookup_idx" ON "iam_catalog_entries" USING btree ("service","kind","status");--> statement-breakpoint
CREATE INDEX "services_owner_idx" ON "services" USING btree ("owner_user_id");