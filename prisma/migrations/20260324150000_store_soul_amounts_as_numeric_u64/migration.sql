ALTER TABLE "soul_series"
ALTER COLUMN "one_time_price_usdc" TYPE NUMERIC(20,0) USING "one_time_price_usdc"::NUMERIC(20,0),
ALTER COLUMN "sub_price_usdc" TYPE NUMERIC(20,0) USING "sub_price_usdc"::NUMERIC(20,0);

ALTER TABLE "soul_prepared_purchases"
ALTER COLUMN "amount_usdc" TYPE NUMERIC(20,0) USING "amount_usdc"::NUMERIC(20,0);
