BEGIN;

ALTER TABLE "soul_memory_entries"
  ADD COLUMN IF NOT EXISTS "timestamp_key" BIGINT,
  ADD COLUMN IF NOT EXISTS "seal_sidecar" JSONB;

UPDATE "soul_memory_entries" sme
SET "timestamp_key" = sub.resolved_key
FROM (
  SELECT id,
    COALESCE("created_at_ms"::BIGINT, "entry_index"::BIGINT)
      + ROW_NUMBER() OVER (
          PARTITION BY "memory_on_chain_id",
                       COALESCE("created_at_ms"::BIGINT, "entry_index"::BIGINT)
          ORDER BY "entry_index"
        ) - 1 AS resolved_key
  FROM "soul_memory_entries"
  WHERE "timestamp_key" IS NULL
) sub
WHERE sme.id = sub.id;

ALTER TABLE "soul_memory_entries"
  ALTER COLUMN "created_at_ms" TYPE BIGINT USING "created_at_ms"::BIGINT,
  ALTER COLUMN "timestamp_key" SET NOT NULL;

DROP INDEX IF EXISTS "soul_memory_entries_on_chain_id_key";
DROP INDEX IF EXISTS "soul_memory_entries_memory_on_chain_id_entry_index_key";
DROP INDEX IF EXISTS "soul_memory_entries_soul_on_chain_id_entry_index_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "soul_memory_entries_memory_on_chain_id_timestamp_key_key"
  ON "soul_memory_entries"("memory_on_chain_id", "timestamp_key");

CREATE INDEX IF NOT EXISTS "soul_memory_entries_soul_on_chain_id_timestamp_key_idx"
  ON "soul_memory_entries"("soul_on_chain_id", "timestamp_key" DESC);

ALTER TABLE "soul_memory_entries"
  DROP COLUMN IF EXISTS "entry_index",
  DROP COLUMN IF EXISTS "on_chain_id";

DROP INDEX IF EXISTS "soul_assets_latest_skill_version_on_chain_id_key";

ALTER TABLE "soul_assets"
  DROP COLUMN IF EXISTS "latest_skill_version_on_chain_id";

ALTER TABLE "soul_skill_version_records"
  ADD COLUMN IF NOT EXISTS "skill_name" TEXT,
  ADD COLUMN IF NOT EXISTS "version_index" INTEGER;

UPDATE "soul_skill_version_records"
SET
  "skill_name" = COALESCE(
    "skill_name",
    NULLIF("version_on_chain_id", ''),
    CONCAT('__legacy__:', "skills_on_chain_id", ':', COALESCE("version_number"::TEXT, '0'))
  ),
  "version_index" = COALESCE("version_index", "version_number", 1)
WHERE "skill_name" IS NULL OR "version_index" IS NULL;

ALTER TABLE "soul_skill_version_records"
  ALTER COLUMN "created_at_ms" TYPE BIGINT USING "created_at_ms"::BIGINT,
  ALTER COLUMN "skill_name" SET NOT NULL,
  ALTER COLUMN "version_index" SET NOT NULL;

DROP INDEX IF EXISTS "soul_skill_version_records_version_on_chain_id_key";
DROP INDEX IF EXISTS "soul_skill_version_records_skills_on_chain_id_version_number_key";
DROP INDEX IF EXISTS "soul_skill_version_records_soul_on_chain_id_version_number_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "soul_skill_version_records_skills_on_chain_id_skill_name_version_index_key"
  ON "soul_skill_version_records"("skills_on_chain_id", "skill_name", "version_index");

CREATE INDEX IF NOT EXISTS "soul_skill_version_records_soul_on_chain_id_skill_name_version_index_idx"
  ON "soul_skill_version_records"("soul_on_chain_id", "skill_name", "version_index" DESC);

ALTER TABLE "soul_skill_version_records"
  DROP COLUMN IF EXISTS "version_on_chain_id",
  DROP COLUMN IF EXISTS "version_number",
  DROP COLUMN IF EXISTS "previous_version_on_chain_id";

COMMIT;
