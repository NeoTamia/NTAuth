CREATE INDEX "audit_events_retention_idx" ON "audit_events" USING btree ("created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ntauth_reject_audit_event_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'audit events are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_events_immutable_update"
BEFORE UPDATE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION ntauth_reject_audit_event_update();
