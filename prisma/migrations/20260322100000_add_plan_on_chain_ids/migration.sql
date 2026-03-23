-- Migration: add one_time_plan_on_chain_id and sub_plan_on_chain_id to soul_series
-- These store the on-chain PricingPlan object IDs so the UI can build purchase transactions.

ALTER TABLE "soul_series" ADD COLUMN "one_time_plan_on_chain_id" TEXT;
ALTER TABLE "soul_series" ADD COLUMN "sub_plan_on_chain_id" TEXT;
