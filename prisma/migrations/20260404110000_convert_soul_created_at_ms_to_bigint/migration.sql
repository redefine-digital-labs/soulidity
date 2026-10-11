BEGIN;

ALTER TABLE "soul_memory_entries"
  ALTER COLUMN "created_at_ms" TYPE BIGINT;

ALTER TABLE "soul_skill_version_records"
  ALTER COLUMN "created_at_ms" TYPE BIGINT;

COMMIT;
