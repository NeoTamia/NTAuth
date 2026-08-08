CREATE TABLE "oauth_token_revocations" (
	"jti" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_token_revocations" ADD CONSTRAINT "oauth_token_revocations_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_token_revocations" ADD CONSTRAINT "oauth_token_revocations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_token_revocations_expires_at_idx" ON "oauth_token_revocations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_token_revocations_session_id_idx" ON "oauth_token_revocations" USING btree ("session_id");