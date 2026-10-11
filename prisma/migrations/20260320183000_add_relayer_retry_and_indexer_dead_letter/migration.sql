ALTER TABLE "settlement_events"
ADD COLUMN "next_retry_at" TIMESTAMPTZ;

DROP INDEX IF EXISTS "settlement_events_settlement_status_relayer_attempts_created_at_idx";

CREATE INDEX "settlement_events_settlement_status_relayer_attempts_updated_at_idx"
ON "settlement_events"("settlement_status", "relayer_attempts", "updated_at");

CREATE INDEX "settlement_events_settlement_status_next_retry_at_created_at_idx"
ON "settlement_events"("settlement_status", "next_retry_at", "created_at");

CREATE TABLE "indexer_dead_letter_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "module_name" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "tx_digest" TEXT NOT NULL,
    "event_seq" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error_message" TEXT NOT NULL,
    "failure_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexer_dead_letter_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "indexer_dead_letter_events_module_name_tx_digest_event_seq_key"
ON "indexer_dead_letter_events"("module_name", "tx_digest", "event_seq");

CREATE INDEX "indexer_dead_letter_events_created_at_idx"
ON "indexer_dead_letter_events"("created_at");
