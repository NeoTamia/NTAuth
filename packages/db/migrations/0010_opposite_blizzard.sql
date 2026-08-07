CREATE TABLE "email_verification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_requests_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "email_verification_email_normalized_check" CHECK ("email_verification_requests"."email" = lower(trim("email_verification_requests"."email"))),
	CONSTRAINT "email_verification_token_hash_check" CHECK (length("email_verification_requests"."token_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "email_verification_requests" ADD CONSTRAINT "email_verification_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_verification_requests_user_idx" ON "email_verification_requests" USING btree ("user_id");