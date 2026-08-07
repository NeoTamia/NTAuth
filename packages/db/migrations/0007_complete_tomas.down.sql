DROP INDEX IF EXISTS "user_status_idx";
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_deleted_at_check";
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_status_check";
ALTER TABLE "user" DROP COLUMN IF EXISTS "deleted_at";
ALTER TABLE "user" DROP COLUMN IF EXISTS "status_changed_at";
ALTER TABLE "user" DROP COLUMN IF EXISTS "status";
