BEGIN;

-- WARNING: DESTRUCTIVE MIGRATION.
-- This hard-cut migration intentionally deletes mirrored Soul rows so the current runtime can
-- rehydrate kiosk-backed Soul state. Do not reuse as-is for a production dataset without an
-- explicit backfill / rollout plan.

ALTER TABLE "soul_assets"
  RENAME COLUMN "agent_grant_address" TO "allowlist_address";

ALTER TABLE "soul_assets"
  RENAME COLUMN "agent_access_cap_on_chain_id" TO "allowlist_cap_on_chain_id";

ALTER TABLE "soul_assets"
  RENAME COLUMN "grant_version" TO "allowlist_version";

ALTER TABLE "soul_assets"
  DROP COLUMN IF EXISTS "listing_source";

ALTER TABLE "soul_assets"
  RENAME COLUMN "seller_kiosk_id" TO "current_kiosk_id";

-- Hard cut: legacy mirrored Soul rows do not contain kiosk-cap IDs, so drop
-- them and let the current runtime rehydrate supported Souls after deploy.
DELETE FROM "soul_prepared_purchases";
DELETE FROM "soul_assets";

ALTER TABLE "soul_assets"
  ADD COLUMN IF NOT EXISTS "current_kiosk_cap_on_chain_id" TEXT;

-- The NOT NULL hardening below depends on the hard-cut DELETE above removing
-- legacy rows that never had kiosk-cap IDs. If that DELETE changes, revisit
-- these constraints and add an explicit backfill first.
ALTER TABLE "soul_assets"
  ALTER COLUMN "current_kiosk_id" SET NOT NULL;

ALTER TABLE "soul_assets"
  ALTER COLUMN "current_kiosk_cap_on_chain_id" SET NOT NULL;

DROP INDEX IF EXISTS "soul_assets_agent_access_cap_on_chain_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "soul_assets_allowlist_cap_on_chain_id_key" ON "soul_assets"("allowlist_cap_on_chain_id");
DROP INDEX IF EXISTS "soul_assets_current_kiosk_cap_on_chain_id_key";
CREATE INDEX IF NOT EXISTS "soul_assets_current_kiosk_id_current_kiosk_cap_on_chain_id_idx"
  ON "soul_assets"("current_kiosk_id", "current_kiosk_cap_on_chain_id");

ALTER TABLE "soul_tx_syncs"
  DROP CONSTRAINT IF EXISTS "soul_tx_syncs_route_key_check";

DELETE FROM "soul_tx_syncs"
WHERE "route_key" NOT IN ('purchase', 'publish', 'allowlist:set', 'allowlist:clear');

ALTER TABLE "soul_tx_syncs"
  ADD CONSTRAINT "soul_tx_syncs_route_key_check"
  CHECK ("route_key" IN ('purchase', 'publish', 'allowlist:set', 'allowlist:clear'));

COMMIT;
