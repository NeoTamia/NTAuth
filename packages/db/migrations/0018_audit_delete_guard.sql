CREATE OR REPLACE FUNCTION ntauth_reject_audit_event_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF current_setting('ntauth.audit_purge', true) IS DISTINCT FROM 'enabled' THEN
		RAISE EXCEPTION 'audit events can only be deleted by the retention purge' USING ERRCODE = '55000';
	END IF;
	RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_events_guarded_delete"
BEFORE DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION ntauth_reject_audit_event_delete();
