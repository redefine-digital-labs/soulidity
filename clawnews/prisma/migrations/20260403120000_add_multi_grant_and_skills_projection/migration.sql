BEGIN;

ALTER TABLE "soul_assets"
  DROP CONSTRAINT IF EXISTS "soul_assets_active_grant_on_chain_id_fkey";

DROP INDEX IF EXISTS "soul_assets_active_grant_on_chain_id_key";
DROP INDEX IF EXISTS "soul_assets_active_grantee_address_listing_status_idx";

ALTER TABLE "soul_assets"
  DROP COLUMN IF EXISTS "active_grant_on_chain_id",
  DROP COLUMN IF EXISTS "active_grantee_address",
  ADD COLUMN IF NOT EXISTS "grant_capacity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "active_grant_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "skills_on_chain_id" TEXT,
  ADD COLUMN IF NOT EXISTS "latest_skill_version_on_chain_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "soul_assets_skills_on_chain_id_key"
  ON "soul_assets"("skills_on_chain_id");

CREATE UNIQUE INDEX IF NOT EXISTS "soul_assets_latest_skill_version_on_chain_id_key"
  ON "soul_assets"("latest_skill_version_on_chain_id");

CREATE INDEX IF NOT EXISTS "soul_assets_skills_on_chain_id_idx"
  ON "soul_assets"("skills_on_chain_id");

ALTER TABLE "soul_grant_records"
  ADD COLUMN IF NOT EXISTS "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "ended_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "replaced_by_grant_on_chain_id" TEXT;

UPDATE "soul_grant_records"
SET "scopes" = ARRAY['seal', 'memory']
WHERE COALESCE(array_length("scopes", 1), 0) = 0;

UPDATE "soul_grant_records"
SET "ended_at" = CASE
  WHEN "status" = 'active' THEN NULL
  ELSE COALESCE("ended_at", "revoked_at", "updated_at")
END
WHERE "ended_at" IS NULL;

ALTER TABLE "soul_grant_records"
  DROP COLUMN IF EXISTS "revoked_at";

CREATE INDEX IF NOT EXISTS "soul_grant_records_replaced_by_grant_on_chain_id_idx"
  ON "soul_grant_records"("replaced_by_grant_on_chain_id");

CREATE TABLE IF NOT EXISTS "soul_skill_version_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "soul_on_chain_id" TEXT NOT NULL,
  "skills_on_chain_id" TEXT NOT NULL,
  "version_on_chain_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "visibility" TEXT NOT NULL,
  "deleted_at" TIMESTAMPTZ,
  "blob_object_id" TEXT NOT NULL,
  "blob_id" TEXT,
  "previous_version_on_chain_id" TEXT,
  "seal_sidecar" JSONB,
  "created_at_ms" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "soul_skill_version_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "soul_skill_version_records_version_on_chain_id_key"
  ON "soul_skill_version_records"("version_on_chain_id");

CREATE UNIQUE INDEX IF NOT EXISTS "soul_skill_version_records_skills_on_chain_id_version_number_key"
  ON "soul_skill_version_records"("skills_on_chain_id", "version_number");

CREATE INDEX IF NOT EXISTS "soul_skill_version_records_soul_on_chain_id_version_number_idx"
  ON "soul_skill_version_records"("soul_on_chain_id", "version_number" DESC);

CREATE INDEX IF NOT EXISTS "soul_skill_version_records_skills_on_chain_id_idx"
  ON "soul_skill_version_records"("skills_on_chain_id");

ALTER TABLE "soul_skill_version_records"
  DROP CONSTRAINT IF EXISTS "soul_skill_version_records_soul_on_chain_id_fkey",
  ADD CONSTRAINT "soul_skill_version_records_soul_on_chain_id_fkey"
    FOREIGN KEY ("soul_on_chain_id") REFERENCES "soul_assets"("on_chain_id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "soul_assets" AS assets
SET "active_grant_count" = active_counts.count
FROM (
  SELECT "soul_on_chain_id", COUNT(*)::INTEGER AS count
  FROM "soul_grant_records"
  WHERE "status" = 'active'
  GROUP BY "soul_on_chain_id"
) AS active_counts
WHERE assets."on_chain_id" = active_counts."soul_on_chain_id";

UPDATE "soul_assets"
SET "active_grant_count" = 0
WHERE "active_grant_count" IS NULL;

ALTER TABLE "soul_tx_syncs"
  DROP CONSTRAINT IF EXISTS "soul_tx_syncs_route_key_check";

ALTER TABLE "soul_tx_syncs"
  ADD CONSTRAINT "soul_tx_syncs_route_key_check"
  CHECK ("route_key" IN (
    'publish',
    'buy',
    'list',
    'delist',
    'grant:issue',
    'grant:revoke',
    'grant:revoke-scope',
    'skills:append',
    'skills:delete',
    'collection:mint',
    'collection:list',
    'collection:delist',
    'collection:buy',
    'import',
    'personal-join'
  ));

COMMIT;
