CREATE TABLE "iam_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service" varchar(63) NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "iam_policies_name_check" CHECK (length(trim("iam_policies"."name")) > 0),
	CONSTRAINT "iam_policies_status_check" CHECK ("iam_policies"."status" in ('active', 'inactive')),
	CONSTRAINT "iam_policies_current_version_check" CHECK ("iam_policies"."current_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "iam_policy_versions" (
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"document_hash" varchar(64) NOT NULL,
	"source_version" integer,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "iam_policy_versions_policy_id_version_pk" PRIMARY KEY("policy_id","version"),
	CONSTRAINT "iam_policy_versions_version_check" CHECK ("iam_policy_versions"."version" > 0),
	CONSTRAINT "iam_policy_versions_source_check" CHECK ("iam_policy_versions"."source_version" is null or "iam_policy_versions"."source_version" > 0),
	CONSTRAINT "iam_policy_versions_hash_check" CHECK ("iam_policy_versions"."document_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "iam_policies" ADD CONSTRAINT "iam_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_policies" ADD CONSTRAINT "iam_policies_service_services_key_fk" FOREIGN KEY ("service") REFERENCES "public"."services"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_policies" ADD CONSTRAINT "iam_policies_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_policy_versions" ADD CONSTRAINT "iam_policy_versions_policy_id_iam_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."iam_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_policy_versions" ADD CONSTRAINT "iam_policy_versions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "iam_policies_scope_name_unique" ON "iam_policies" USING btree ("organization_id","service","name");--> statement-breakpoint
CREATE INDEX "iam_policies_scope_idx" ON "iam_policies" USING btree ("organization_id","service","status");--> statement-breakpoint
CREATE INDEX "iam_policy_versions_policy_created_idx" ON "iam_policy_versions" USING btree ("policy_id","created_at");
--> statement-breakpoint
CREATE FUNCTION prevent_iam_policy_version_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'IAM policy versions are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER iam_policy_versions_immutable
BEFORE UPDATE ON iam_policy_versions
FOR EACH ROW EXECUTE FUNCTION prevent_iam_policy_version_update();
