-- Add 'renew' to route_key CHECK constraint
ALTER TABLE "soul_tx_syncs"
DROP CONSTRAINT IF EXISTS "soul_tx_syncs_route_key_check";

ALTER TABLE "soul_tx_syncs"
ADD CONSTRAINT "soul_tx_syncs_route_key_check"
CHECK ("route_key" IN ('purchase', 'publish', 'release', 'grant:set', 'grant:revoke', 'renew'));

-- Add pass_on_chain_id to prepared purchases for renew flow
ALTER TABLE "soul_prepared_purchases"
ADD COLUMN IF NOT EXISTS "pass_on_chain_id" TEXT;

-- Add last_renew_tx_digest to pass snapshots for renewal traceability
ALTER TABLE "soul_pass_snapshots"
ADD COLUMN IF NOT EXISTS "last_renew_tx_digest" TEXT;
