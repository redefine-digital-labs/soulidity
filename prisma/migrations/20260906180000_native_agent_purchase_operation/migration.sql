-- Durable native purchase bytes, verified snapshot, signature and recovery state.
-- Nullable only for ordinary Soul purchases; native execution rejects a missing packet.
ALTER TABLE "soul_prepared_purchases"
  ADD COLUMN "native_operation" JSONB,
  ADD COLUMN "operation_revision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "soul_prepared_purchases"
  ADD CONSTRAINT "soul_prepared_purchases_operation_revision_nonnegative"
  CHECK ("operation_revision" >= 0);

CREATE INDEX "soul_prepared_purchases_native_buyer_history_idx"
  ON "soul_prepared_purchases" ("soul_on_chain_id", "agent_address", "created_at" DESC);
