CREATE TABLE "iam_group_members" (
	"group_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"added_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "iam_group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "iam_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "iam_groups_name_check" CHECK (length(trim("iam_groups"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "iam_policy_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"principal_type" varchar(16) NOT NULL,
	"principal_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"detached_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detached_at" timestamp with time zone,
	CONSTRAINT "iam_policy_attachments_principal_type_check" CHECK ("iam_policy_attachments"."principal_type" in ('user', 'group', 'role')),
	CONSTRAINT "iam_policy_attachments_detachment_check" CHECK (("iam_policy_attachments"."detached_at" is null and "iam_policy_attachments"."detached_by_user_id" is null) or ("iam_policy_attachments"."detached_at" is not null and "iam_policy_attachments"."detached_by_user_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "iam_group_members" ADD CONSTRAINT "iam_group_members_group_id_iam_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."iam_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_group_members" ADD CONSTRAINT "iam_group_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_group_members" ADD CONSTRAINT "iam_group_members_added_by_user_id_user_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_groups" ADD CONSTRAINT "iam_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_groups" ADD CONSTRAINT "iam_groups_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_policy_attachments" ADD CONSTRAINT "iam_policy_attachments_policy_id_iam_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."iam_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_policy_attachments" ADD CONSTRAINT "iam_policy_attachments_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_policy_attachments" ADD CONSTRAINT "iam_policy_attachments_detached_by_user_id_user_id_fk" FOREIGN KEY ("detached_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "iam_group_members_user_idx" ON "iam_group_members" USING btree ("user_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iam_groups_organization_name_unique" ON "iam_groups" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "iam_groups_organization_idx" ON "iam_groups" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iam_policy_attachments_active_principal_unique" ON "iam_policy_attachments" USING btree ("policy_id","principal_type","principal_id") WHERE "iam_policy_attachments"."detached_at" is null;--> statement-breakpoint
CREATE INDEX "iam_policy_attachments_principal_idx" ON "iam_policy_attachments" USING btree ("principal_type","principal_id","policy_id");