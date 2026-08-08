DROP TRIGGER IF EXISTS iam_policy_versions_immutable ON iam_policy_versions;
--> statement-breakpoint
DROP FUNCTION IF EXISTS prevent_iam_policy_version_update();
--> statement-breakpoint
DROP TABLE IF EXISTS iam_policy_versions;
--> statement-breakpoint
DROP TABLE IF EXISTS iam_policies;
