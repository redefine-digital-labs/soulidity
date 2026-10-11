ALTER TABLE "soul_prepared_purchases"
DROP CONSTRAINT IF EXISTS "soul_prepared_purchases_plan_type_check";

ALTER TABLE "soul_prepared_purchases"
ADD CONSTRAINT "soul_prepared_purchases_plan_type_check"
CHECK ("plan_type" IN ('onetime', 'subscription'));

ALTER TABLE "soul_tx_syncs"
DROP CONSTRAINT IF EXISTS "soul_tx_syncs_route_key_check";

ALTER TABLE "soul_tx_syncs"
ADD CONSTRAINT "soul_tx_syncs_route_key_check"
CHECK ("route_key" IN ('purchase', 'publish', 'grant:set', 'grant:revoke'));
