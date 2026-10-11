DELETE FROM "soul_prepared_purchases";

DELETE FROM "soul_tx_syncs"
WHERE "route_key" IN ('publish', 'purchase', 'allowlist:set', 'allowlist:clear');

DELETE FROM "soul_assets";
