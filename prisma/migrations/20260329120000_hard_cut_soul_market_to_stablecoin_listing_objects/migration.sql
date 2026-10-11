BEGIN;

ALTER TABLE "soul_assets"
  RENAME COLUMN "listed_price_sui" TO "listed_price_atomic";

ALTER TABLE "soul_assets"
  ADD COLUMN "creator_royalty_bps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "listing_object_on_chain_id" TEXT;

-- Old listed rows do not carry the new listing object shared id, so hard-cut them
-- back to held until they are mirrored from a fresh fixed-price listing.
UPDATE "soul_assets"
SET
  "listing_status" = 'held',
  "listed_price_atomic" = NULL,
  "listing_object_on_chain_id" = NULL
WHERE "listing_object_on_chain_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "soul_assets_listing_object_on_chain_id_key"
ON "soul_assets" ("listing_object_on_chain_id")
WHERE "listing_object_on_chain_id" IS NOT NULL;

ALTER TABLE "soul_prepared_purchases"
  RENAME COLUMN "price_sui" TO "price_atomic";

ALTER TABLE "soul_prepared_purchases"
  ADD COLUMN "listing_object_id" TEXT,
  ADD COLUMN "platform_fee_atomic" DECIMAL(20, 0) NOT NULL DEFAULT 0,
  ADD COLUMN "creator_royalty_atomic" DECIMAL(20, 0) NOT NULL DEFAULT 0,
  ADD COLUMN "total_atomic" DECIMAL(20, 0) NOT NULL DEFAULT 0;

-- Prepared purchases built before the stablecoin hard-cut are invalid because they
-- do not bind the shared listing object and still assume the old payment semantics.
DELETE FROM "soul_prepared_purchases";

ALTER TABLE "soul_prepared_purchases"
  ALTER COLUMN "listing_object_id" SET NOT NULL;

COMMIT;
