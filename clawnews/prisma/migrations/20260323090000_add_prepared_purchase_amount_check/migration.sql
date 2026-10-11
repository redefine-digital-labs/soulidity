ALTER TABLE "soul_prepared_purchases"
DROP CONSTRAINT IF EXISTS "soul_prepared_purchases_amount_usdc_positive_check";

ALTER TABLE "soul_prepared_purchases"
ADD CONSTRAINT "soul_prepared_purchases_amount_usdc_positive_check"
CHECK ("amount_usdc" > 0);
