BEGIN;

ALTER TABLE "soul_collection_assets"
  ADD COLUMN IF NOT EXISTS "floor_price_atomic" DECIMAL(20, 0);

COMMIT;
