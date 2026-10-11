ALTER TABLE "soul_tx_syncs"
DROP CONSTRAINT IF EXISTS "soul_tx_syncs_route_key_check";

ALTER TABLE "soul_tx_syncs"
ADD CONSTRAINT "soul_tx_syncs_route_key_check"
CHECK ("route_key" IN ('purchase', 'publish', 'delist', 'allowlist:set', 'allowlist:clear'));
