DROP TRIGGER IF EXISTS "audit_events_guarded_delete" ON "audit_events";
--> statement-breakpoint
DROP FUNCTION IF EXISTS ntauth_reject_audit_event_delete();
