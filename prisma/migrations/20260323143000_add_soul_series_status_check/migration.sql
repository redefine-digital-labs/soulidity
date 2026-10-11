ALTER TABLE "soul_series"
DROP CONSTRAINT IF EXISTS "soul_series_status_check";

ALTER TABLE "soul_series"
ADD CONSTRAINT "soul_series_status_check"
CHECK ("status" IN ('active', 'inactive'));
