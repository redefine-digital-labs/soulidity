-- Phase 2 Hard Cut: Unified Content Kind Matrix
--
-- D5 (per docs/plans/2026-05-04-soulidity-unified-content-phase2.md):
--   "旧 mainnet 数据全弃；DB schema 重置". This migration drops every
--   mirror table tied to the deleted Move modules (memory.move,
--   skills.move, assets.move, metadata.move, content_access.move,
--   seal_policy.move) and replaces them with a single unified
--   `soul_content_version_records` table plus per-kind paid-access
--   tables (`soul_paid_access_kind_configs`,
--   `soul_paid_access_entries`).
--
-- IMPORTANT: this migration deletes data. Run only against a Soulidity
-- environment that has been agreed to reset (testnet / dev DB). Mainnet
-- data is intentionally not migrated — the new package is a fresh deploy.

-- ── Drop legacy mirror tables ────────────────────────────────────────
DROP TABLE IF EXISTS "soul_memory_entries"            CASCADE;
DROP TABLE IF EXISTS "soul_skill_version_records"     CASCADE;
DROP TABLE IF EXISTS "soul_asset_version_records"     CASCADE;
DROP TABLE IF EXISTS "content_access_records"         CASCADE;

-- ── Drop columns on soul_assets that referenced deleted Move objects ─
ALTER TABLE "soul_assets"
  DROP COLUMN IF EXISTS "memory_on_chain_id",
  DROP COLUMN IF EXISTS "skills_on_chain_id",
  DROP COLUMN IF EXISTS "assets_on_chain_id",
  DROP COLUMN IF EXISTS "metadata_on_chain_id",
  DROP COLUMN IF EXISTS "access_list_on_chain_id",
  DROP COLUMN IF EXISTS "content_blob_id",
  DROP COLUMN IF EXISTS "content_blob_object_id",
  DROP COLUMN IF EXISTS "seal_sidecar",
  DROP COLUMN IF EXISTS "active_sprite_asset_name",
  DROP COLUMN IF EXISTS "active_voice_asset_name";

-- ── Drop indexes that referenced removed columns ─────────────────────
DROP INDEX IF EXISTS "soul_assets_skills_on_chain_id_idx";

-- ── Add Phase 2 columns to soul_assets ───────────────────────────────
ALTER TABLE "soul_assets"
  ADD COLUMN "content_on_chain_id"              TEXT,
  ADD COLUMN "active_sprite_name"               TEXT,
  ADD COLUMN "active_voice_name"                TEXT,
  ADD COLUMN "paid_access_list_on_chain_id"     TEXT;

CREATE UNIQUE INDEX "soul_assets_content_on_chain_id_key"
  ON "soul_assets"("content_on_chain_id")
  WHERE "content_on_chain_id" IS NOT NULL;

CREATE UNIQUE INDEX "soul_assets_paid_access_list_on_chain_id_key"
  ON "soul_assets"("paid_access_list_on_chain_id")
  WHERE "paid_access_list_on_chain_id" IS NOT NULL;

-- ── soul_content_version_records ─────────────────────────────────────
CREATE TABLE "soul_content_version_records" (
    "id"                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    "soul_on_chain_id"    TEXT         NOT NULL,
    "content_on_chain_id" TEXT         NOT NULL,
    "kind"                INTEGER      NOT NULL,
    "kind_name"           TEXT         NOT NULL,
    "name"                TEXT         NOT NULL,
    "version_index"       INTEGER      NOT NULL,
    "blob_object_id"      TEXT         NOT NULL,
    "blob_id"             TEXT,
    "read_mode_mask"      INTEGER      NOT NULL,
    "op_mask"             INTEGER      NOT NULL,
    "grant_scope_mask"    INTEGER      NOT NULL,
    "is_public"           BOOLEAN      NOT NULL,
    "seal_encrypted"      BOOLEAN      NOT NULL DEFAULT TRUE,
    "download_policy"     INTEGER      NOT NULL,
    "seal_sidecar"        JSONB,
    "deleted_at"          TIMESTAMPTZ,
    "purged_at"           TIMESTAMPTZ,
    "created_at_ms"       BIGINT       NOT NULL,
    "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT "soul_content_version_records_soul_fk"
      FOREIGN KEY ("soul_on_chain_id")
      REFERENCES "soul_assets"("on_chain_id")
      ON DELETE CASCADE
);

CREATE UNIQUE INDEX "soul_content_version_unique"
  ON "soul_content_version_records"("content_on_chain_id", "kind", "name", "version_index");

CREATE INDEX "soul_content_version_records_soul_kind_name_version_idx"
  ON "soul_content_version_records"("soul_on_chain_id", "kind", "name", "version_index" DESC);

CREATE INDEX "soul_content_version_records_soul_kind_deleted_idx"
  ON "soul_content_version_records"("soul_on_chain_id", "kind", "deleted_at");

CREATE INDEX "soul_content_version_records_content_idx"
  ON "soul_content_version_records"("content_on_chain_id");

-- ── soul_paid_access_kind_configs ────────────────────────────────────
CREATE TABLE "soul_paid_access_kind_configs" (
    "id"                            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    "soul_on_chain_id"              TEXT          NOT NULL,
    "paid_access_list_on_chain_id"  TEXT          NOT NULL,
    "kind"                          INTEGER       NOT NULL,
    "version"                       INTEGER       NOT NULL DEFAULT 1,
    "price_atomic"                  NUMERIC(20, 0) NOT NULL,
    "scope_mask"                    INTEGER       NOT NULL,
    "duration_ms"                   BIGINT,
    "ownership_epoch_snapshot"      INTEGER       NOT NULL,
    "deleted_at"                    TIMESTAMPTZ,
    "created_at"                    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    "updated_at"                    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT "soul_paid_access_kind_configs_soul_fk"
      FOREIGN KEY ("soul_on_chain_id")
      REFERENCES "soul_assets"("on_chain_id")
      ON DELETE CASCADE
);

CREATE UNIQUE INDEX "soul_paid_access_kind_config_unique"
  ON "soul_paid_access_kind_configs"("paid_access_list_on_chain_id", "kind");

CREATE INDEX "soul_paid_access_kind_configs_soul_idx"
  ON "soul_paid_access_kind_configs"("soul_on_chain_id");

CREATE INDEX "soul_paid_access_kind_configs_soul_kind_idx"
  ON "soul_paid_access_kind_configs"("soul_on_chain_id", "kind");

-- ── soul_paid_access_entries ─────────────────────────────────────────
CREATE TABLE "soul_paid_access_entries" (
    "id"                            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    "soul_on_chain_id"              TEXT          NOT NULL,
    "paid_access_list_on_chain_id"  TEXT          NOT NULL,
    "buyer_address"                 TEXT          NOT NULL,
    "kind"                          INTEGER       NOT NULL,
    "version"                       INTEGER       NOT NULL DEFAULT 1,
    "scope_mask"                    INTEGER       NOT NULL,
    "price_paid_atomic"             NUMERIC(20, 0) NOT NULL,
    "expires_at_ms"                 BIGINT,
    "ownership_epoch_snapshot"      INTEGER       NOT NULL,
    "revoked_at"                    TIMESTAMPTZ,
    "created_at_ms"                 BIGINT        NOT NULL,
    "created_at"                    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    "updated_at"                    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT "soul_paid_access_entries_soul_fk"
      FOREIGN KEY ("soul_on_chain_id")
      REFERENCES "soul_assets"("on_chain_id")
      ON DELETE CASCADE
);

CREATE UNIQUE INDEX "soul_paid_access_entry_unique"
  ON "soul_paid_access_entries"("buyer_address", "paid_access_list_on_chain_id", "kind");

CREATE INDEX "soul_paid_access_entries_soul_buyer_idx"
  ON "soul_paid_access_entries"("soul_on_chain_id", "buyer_address");

CREATE INDEX "soul_paid_access_entries_list_kind_idx"
  ON "soul_paid_access_entries"("paid_access_list_on_chain_id", "kind");

CREATE INDEX "soul_paid_access_entries_buyer_revoked_idx"
  ON "soul_paid_access_entries"("buyer_address", "revoked_at");

-- Verify state by re-deriving on-chain projections from current package.
