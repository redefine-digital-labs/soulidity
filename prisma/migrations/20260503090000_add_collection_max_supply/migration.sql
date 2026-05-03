-- Mirror of SoulCollection.max_supply (Move Option<u64>).
--   NULL  -> unlimited
--   value -> on-chain supply cap
-- soul_count keeps mirroring SoulCollection.current_supply (monotonic).
ALTER TABLE "soul_collection_assets"
ADD COLUMN IF NOT EXISTS "max_soul_supply" BIGINT;
