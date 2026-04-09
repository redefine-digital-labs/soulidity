BEGIN;

-- Soulidity hard cut:
-- 1. clear legacy mirrored data so old object-model rows cannot mix with Soulidity rows
-- 2. drop allowlist-era columns
-- 3. add Soulidity projection columns and tables
-- 4. reset tx-sync route keys to the Soulidity runtime

DELETE FROM "soul_prepared_purchases";
DELETE FROM "soul_tx_syncs";
DELETE FROM "soul_assets";

DROP INDEX IF EXISTS "soul_assets_allowlist_cap_on_chain_id_key";

ALTER TABLE "soul_assets"
  DROP COLUMN IF EXISTS "allowlist_address",
  DROP COLUMN IF EXISTS "allowlist_cap_on_chain_id",
  DROP COLUMN IF EXISTS "allowlist_version",
  ADD COLUMN IF NOT EXISTS "state_on_chain_id" TEXT,
  ADD COLUMN IF NOT EXISTS "memory_on_chain_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provenance_kind" TEXT NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS "origin_ref" TEXT,
  ADD COLUMN IF NOT EXISTS "collection_on_chain_id" TEXT,
  ADD COLUMN IF NOT EXISTS "active_grant_on_chain_id" TEXT,
  ADD COLUMN IF NOT EXISTS "active_grantee_address" TEXT;

ALTER TABLE "soul_assets"
  ALTER COLUMN "state_on_chain_id" SET NOT NULL,
  ALTER COLUMN "memory_on_chain_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "soul_assets_state_on_chain_id_key"
  ON "soul_assets"("state_on_chain_id");

CREATE UNIQUE INDEX IF NOT EXISTS "soul_assets_memory_on_chain_id_key"
  ON "soul_assets"("memory_on_chain_id");

CREATE UNIQUE INDEX IF NOT EXISTS "soul_assets_active_grant_on_chain_id_key"
  ON "soul_assets"("active_grant_on_chain_id");

CREATE INDEX IF NOT EXISTS "soul_assets_collection_on_chain_id_listing_status_idx"
  ON "soul_assets"("collection_on_chain_id", "listing_status");

CREATE INDEX IF NOT EXISTS "soul_assets_active_grantee_address_listing_status_idx"
  ON "soul_assets"("active_grantee_address", "listing_status");

CREATE TABLE IF NOT EXISTS "soul_collection_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "on_chain_id" TEXT NOT NULL,
  "right_on_chain_id" TEXT NOT NULL,
  "creator_member_id" UUID,
  "creator_address" TEXT NOT NULL,
  "current_holder_member_id" UUID,
  "current_holder_address" TEXT NOT NULL,
  "current_holder_kiosk_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "image_url" TEXT NOT NULL,
  "extra_royalty_bps" INTEGER NOT NULL DEFAULT 0,
  "tradeable" BOOLEAN NOT NULL DEFAULT true,
  "listing_object_on_chain_id" TEXT,
  "listed_price_atomic" DECIMAL(20, 0),
  "listing_status" TEXT NOT NULL DEFAULT 'held',
  "soul_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "soul_collection_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "soul_collection_assets_on_chain_id_key"
  ON "soul_collection_assets"("on_chain_id");

CREATE UNIQUE INDEX IF NOT EXISTS "soul_collection_assets_right_on_chain_id_key"
  ON "soul_collection_assets"("right_on_chain_id");

CREATE INDEX IF NOT EXISTS "soul_collection_assets_creator_member_id_listing_status_idx"
  ON "soul_collection_assets"("creator_member_id", "listing_status");

CREATE INDEX IF NOT EXISTS "soul_collection_assets_current_holder_member_id_listing_status_idx"
  ON "soul_collection_assets"("current_holder_member_id", "listing_status");

CREATE INDEX IF NOT EXISTS "soul_collection_assets_current_holder_address_listing_status_idx"
  ON "soul_collection_assets"("current_holder_address", "listing_status");

CREATE INDEX IF NOT EXISTS "soul_collection_assets_listing_status_created_at_idx"
  ON "soul_collection_assets"("listing_status", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "soul_grant_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "on_chain_id" TEXT NOT NULL,
  "soul_on_chain_id" TEXT NOT NULL,
  "issued_by_member_id" UUID,
  "issued_by_address" TEXT NOT NULL,
  "grantee_member_id" UUID,
  "grantee_address" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expires_at" TIMESTAMPTZ,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "soul_grant_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "soul_grant_records_on_chain_id_key"
  ON "soul_grant_records"("on_chain_id");

CREATE INDEX IF NOT EXISTS "soul_grant_records_soul_on_chain_id_status_idx"
  ON "soul_grant_records"("soul_on_chain_id", "status");

CREATE INDEX IF NOT EXISTS "soul_grant_records_grantee_address_status_idx"
  ON "soul_grant_records"("grantee_address", "status");

CREATE INDEX IF NOT EXISTS "soul_grant_records_issued_by_address_status_idx"
  ON "soul_grant_records"("issued_by_address", "status");

CREATE TABLE IF NOT EXISTS "soul_memory_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "on_chain_id" TEXT NOT NULL,
  "soul_on_chain_id" TEXT NOT NULL,
  "memory_on_chain_id" TEXT NOT NULL,
  "entry_index" INTEGER NOT NULL,
  "writer_address" TEXT NOT NULL,
  "writer_kind" TEXT NOT NULL,
  "blob_object_id" TEXT NOT NULL,
  "blob_id" TEXT,
  "created_at_ms" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "soul_memory_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "soul_memory_entries_on_chain_id_key"
  ON "soul_memory_entries"("on_chain_id");

CREATE UNIQUE INDEX IF NOT EXISTS "soul_memory_entries_memory_on_chain_id_entry_index_key"
  ON "soul_memory_entries"("memory_on_chain_id", "entry_index");

CREATE INDEX IF NOT EXISTS "soul_memory_entries_soul_on_chain_id_entry_index_idx"
  ON "soul_memory_entries"("soul_on_chain_id", "entry_index" DESC);

ALTER TABLE "soul_collection_assets"
  DROP CONSTRAINT IF EXISTS "soul_collection_assets_creator_member_id_fkey",
  ADD CONSTRAINT "soul_collection_assets_creator_member_id_fkey"
    FOREIGN KEY ("creator_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  DROP CONSTRAINT IF EXISTS "soul_collection_assets_current_holder_member_id_fkey",
  ADD CONSTRAINT "soul_collection_assets_current_holder_member_id_fkey"
    FOREIGN KEY ("current_holder_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "soul_grant_records"
  DROP CONSTRAINT IF EXISTS "soul_grant_records_soul_on_chain_id_fkey",
  ADD CONSTRAINT "soul_grant_records_soul_on_chain_id_fkey"
    FOREIGN KEY ("soul_on_chain_id") REFERENCES "soul_assets"("on_chain_id") ON DELETE CASCADE ON UPDATE CASCADE,
  DROP CONSTRAINT IF EXISTS "soul_grant_records_issued_by_member_id_fkey",
  ADD CONSTRAINT "soul_grant_records_issued_by_member_id_fkey"
    FOREIGN KEY ("issued_by_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  DROP CONSTRAINT IF EXISTS "soul_grant_records_grantee_member_id_fkey",
  ADD CONSTRAINT "soul_grant_records_grantee_member_id_fkey"
    FOREIGN KEY ("grantee_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "soul_memory_entries"
  DROP CONSTRAINT IF EXISTS "soul_memory_entries_soul_on_chain_id_fkey",
  ADD CONSTRAINT "soul_memory_entries_soul_on_chain_id_fkey"
    FOREIGN KEY ("soul_on_chain_id") REFERENCES "soul_assets"("on_chain_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "soul_assets"
  DROP CONSTRAINT IF EXISTS "soul_assets_collection_on_chain_id_fkey",
  ADD CONSTRAINT "soul_assets_collection_on_chain_id_fkey"
    FOREIGN KEY ("collection_on_chain_id") REFERENCES "soul_collection_assets"("on_chain_id") ON DELETE SET NULL ON UPDATE CASCADE,
  DROP CONSTRAINT IF EXISTS "soul_assets_active_grant_on_chain_id_fkey",
  ADD CONSTRAINT "soul_assets_active_grant_on_chain_id_fkey"
    FOREIGN KEY ("active_grant_on_chain_id") REFERENCES "soul_grant_records"("on_chain_id") ON DELETE SET NULL ON UPDATE CASCADE;

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
    'collection:mint',
    'collection:list',
    'collection:delist',
    'collection:buy',
    'import',
    'personal-join'
  ));

COMMIT;
