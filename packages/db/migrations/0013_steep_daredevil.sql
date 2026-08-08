CREATE TABLE "service_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service" varchar(63) NOT NULL,
	"user_id" text NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"revoked_by_user_id" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_grants_service_check" CHECK ("service_grants"."service" ~ '^[a-z][a-z0-9-]{0,62}$'),
	CONSTRAINT "service_grants_status_check" CHECK ("service_grants"."status" in ('active', 'inactive', 'revoked')),
	CONSTRAINT "service_grants_revocation_check" CHECK (("service_grants"."status" = 'revoked' and "service_grants"."revoked_at" is not null and "service_grants"."revoked_by_user_id" is not null) or ("service_grants"."status" <> 'revoked' and "service_grants"."revoked_at" is null and "service_grants"."revoked_by_user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "service_grants" ADD CONSTRAINT "service_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_grants" ADD CONSTRAINT "service_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_grants" ADD CONSTRAINT "service_grants_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_grants" ADD CONSTRAINT "service_grants_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_grants_current_subject_unique" ON "service_grants" USING btree ("organization_id","service","user_id") WHERE "service_grants"."status" <> 'revoked';--> statement-breakpoint
CREATE INDEX "service_grants_subject_idx" ON "service_grants" USING btree ("user_id","organization_id","service");