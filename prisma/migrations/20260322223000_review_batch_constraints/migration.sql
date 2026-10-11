ALTER TABLE "wallet_challenges"
ADD COLUMN IF NOT EXISTS "domain" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "soul_tx_syncs_route_key_tx_digest_actor_key_resource_key_key"
ON "soul_tx_syncs"("route_key", "tx_digest", "actor_key", "resource_key");

DROP INDEX IF EXISTS "soul_tx_syncs_route_key_tx_digest_actor_key_key";

CREATE UNIQUE INDEX IF NOT EXISTS "soul_prepared_purchases_agent_member_id_tx_bytes_hash_key"
ON "soul_prepared_purchases"("agent_member_id", "tx_bytes_hash");

DO $$
DECLARE
  orphaned_one_time_rows bigint;
  orphaned_subscription_rows bigint;
BEGIN
  SELECT COUNT(*) INTO orphaned_one_time_rows
  FROM "soul_series"
  WHERE "one_time_price_usdc" IS NOT NULL
    AND "one_time_plan_on_chain_id" IS NULL;

  IF orphaned_one_time_rows > 0 THEN
    RAISE NOTICE 'Clearing % orphaned one-time Soul pricing rows before adding the coupling constraint', orphaned_one_time_rows;
  END IF;

  UPDATE "soul_series"
  SET "one_time_price_usdc" = NULL
  WHERE "one_time_price_usdc" IS NOT NULL
    AND "one_time_plan_on_chain_id" IS NULL;

  SELECT COUNT(*) INTO orphaned_subscription_rows
  FROM "soul_series"
  WHERE ("sub_price_usdc" IS NOT NULL OR "sub_period_days" IS NOT NULL)
    AND "sub_plan_on_chain_id" IS NULL;

  IF orphaned_subscription_rows > 0 THEN
    RAISE NOTICE 'Clearing % orphaned subscription Soul pricing rows before adding the coupling constraint', orphaned_subscription_rows;
  END IF;

  UPDATE "soul_series"
  SET "sub_price_usdc" = NULL,
      "sub_period_days" = NULL
  WHERE ("sub_price_usdc" IS NOT NULL OR "sub_period_days" IS NOT NULL)
    AND "sub_plan_on_chain_id" IS NULL;
END $$;

ALTER TABLE "soul_series"
ADD CONSTRAINT "soul_series_one_time_price_plan_coupled"
CHECK (("one_time_price_usdc" IS NULL) = ("one_time_plan_on_chain_id" IS NULL));

ALTER TABLE "soul_series"
ADD CONSTRAINT "soul_series_subscription_price_plan_coupled"
CHECK (
  ("sub_price_usdc" IS NULL) = ("sub_plan_on_chain_id" IS NULL)
  AND ("sub_price_usdc" IS NULL) = ("sub_period_days" IS NULL)
  AND ("sub_period_days" IS NULL OR "sub_period_days" > 0)
);
