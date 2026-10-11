ALTER TABLE "soul_assets"
DROP CONSTRAINT IF EXISTS "soul_assets_listing_status_check";

ALTER TABLE "soul_assets"
ADD CONSTRAINT "soul_assets_listing_status_check"
CHECK ("listing_status" IN ('held', 'listed'));
