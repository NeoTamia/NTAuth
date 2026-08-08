DROP TRIGGER IF EXISTS "audit_events_immutable_update" ON "audit_events";
--> statement-breakpoint
DROP FUNCTION IF EXISTS ntauth_reject_audit_event_update();
--> statement-breakpoint
DROP INDEX IF EXISTS "audit_events_retention_idx";
