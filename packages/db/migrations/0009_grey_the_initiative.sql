CREATE TABLE "mfa_enrollments" (
	"user_id" text PRIMARY KEY NOT NULL,
	"encrypted_secret" text NOT NULL,
	"verified_at" timestamp with time zone,
	"last_used_counter" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_last_used_counter_check" CHECK ("mfa_enrollments"."last_used_counter" is null or "mfa_enrollments"."last_used_counter" >= 0)
);
--> statement-breakpoint
ALTER TABLE "mfa_enrollments" ADD CONSTRAINT "mfa_enrollments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;