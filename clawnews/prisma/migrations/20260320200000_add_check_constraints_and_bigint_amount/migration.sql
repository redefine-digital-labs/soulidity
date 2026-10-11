-- Widen amountUsdc from INTEGER to BIGINT (matches Move u64 range)
ALTER TABLE "settlement_events" ALTER COLUMN "amount_usdc" SET DATA TYPE BIGINT;

-- CHECK constraints for Soul Market status/type fields
ALTER TABLE "soul_pass_snapshots"
  ADD CONSTRAINT "soul_pass_snapshots_pass_type_check"
  CHECK ("pass_type" IN ('perpetual', 'subscription'));

ALTER TABLE "soul_pass_snapshots"
  ADD CONSTRAINT "soul_pass_snapshots_status_check"
  CHECK ("status" IN ('active', 'revoked'));

ALTER TABLE "settlement_events"
  ADD CONSTRAINT "settlement_events_settlement_status_check"
  CHECK ("settlement_status" IN ('pending', 'processing', 'completed', 'failed'));

ALTER TABLE "settlement_events"
  ADD CONSTRAINT "settlement_events_plan_type_check"
  CHECK ("plan_type" IN ('onetime', 'subscription'));

ALTER TABLE "soul_series"
  ADD CONSTRAINT "soul_series_status_check"
  CHECK ("status" IN ('active', 'inactive'));
