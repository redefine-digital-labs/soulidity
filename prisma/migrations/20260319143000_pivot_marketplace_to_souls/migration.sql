-- Pivot from the legacy AgentBundle marketplace to the Soul marketplace.
-- Existing marketplace data is treated as disposable development data.

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping pg_trgm extension creation because the current role lacks privileges.';
END $$;

DROP TABLE IF EXISTS "entitlements";
DROP TABLE IF EXISTS "orders";
DROP TABLE IF EXISTS "purchase_intents";
DROP TABLE IF EXISTS "listings";
DROP TABLE IF EXISTS "agent_bundles";

CREATE TABLE "soul_series" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "on_chain_id" TEXT NOT NULL,
    "author_member_id" UUID,
    "author_address" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT[] NOT NULL,
    "preview_images" TEXT[] NOT NULL,
    "readme" TEXT,
    "latest_release_id" UUID,
    "one_time_price_usdc" INTEGER,
    "sub_price_usdc" INTEGER,
    "sub_period_days" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "soul_series_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "soul_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "on_chain_id" TEXT NOT NULL,
    "series_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "walrus_blob_ref" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "changelog" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "soul_releases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "soul_pass_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "on_chain_id" TEXT NOT NULL,
    "series_id" UUID NOT NULL,
    "owner_address" TEXT NOT NULL,
    "owner_member_id" UUID,
    "pass_type" TEXT NOT NULL,
    "locked_release_id" UUID,
    "expires_at" TIMESTAMPTZ,
    "agent_grant" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "mint_tx_digest" TEXT NOT NULL,
    "last_synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "soul_pass_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settlement_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_chain" TEXT NOT NULL,
    "payment_tx_digest" TEXT NOT NULL,
    "payer_address" TEXT NOT NULL,
    "payer_member_id" UUID,
    "series_on_chain_id" TEXT NOT NULL,
    "amount_usdc" INTEGER NOT NULL,
    "plan_type" TEXT NOT NULL,
    "settlement_status" TEXT NOT NULL DEFAULT 'pending',
    "sui_tx_digest" TEXT,
    "minted_pass_id" TEXT,
    "error_message" TEXT,
    "relayer_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "indexer_cursors" (
    "id" TEXT NOT NULL DEFAULT 'sui-soul-events',
    "checkpoint" BIGINT NOT NULL DEFAULT 0,
    "cursor_data" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexer_cursors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "soul_series_on_chain_id_key" ON "soul_series"("on_chain_id");
CREATE INDEX "soul_series_author_member_id_status_idx" ON "soul_series"("author_member_id", "status");
CREATE INDEX "soul_series_category_idx" ON "soul_series"("category");
CREATE INDEX "soul_series_created_at_idx" ON "soul_series"("created_at" DESC);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        EXECUTE 'CREATE INDEX "soul_series_name_trgm_idx" ON "soul_series" USING GIN ("name" gin_trgm_ops)';
        EXECUTE 'CREATE INDEX "soul_series_description_trgm_idx" ON "soul_series" USING GIN ("description" gin_trgm_ops)';
    END IF;
END $$;

CREATE UNIQUE INDEX "soul_releases_on_chain_id_key" ON "soul_releases"("on_chain_id");
CREATE INDEX "soul_releases_series_id_created_at_idx" ON "soul_releases"("series_id", "created_at" DESC);

CREATE UNIQUE INDEX "soul_pass_snapshots_on_chain_id_key" ON "soul_pass_snapshots"("on_chain_id");
CREATE INDEX "soul_pass_snapshots_owner_member_id_status_idx" ON "soul_pass_snapshots"("owner_member_id", "status");
CREATE INDEX "soul_pass_snapshots_owner_address_status_idx" ON "soul_pass_snapshots"("owner_address", "status");
CREATE INDEX "soul_pass_snapshots_series_id_status_idx" ON "soul_pass_snapshots"("series_id", "status");

CREATE UNIQUE INDEX "settlement_events_payment_tx_digest_key" ON "settlement_events"("payment_tx_digest");
CREATE UNIQUE INDEX "settlement_events_sui_tx_digest_key" ON "settlement_events"("sui_tx_digest");
CREATE INDEX "settlement_events_settlement_status_idx" ON "settlement_events"("settlement_status");
CREATE INDEX "settlement_events_payer_member_id_idx" ON "settlement_events"("payer_member_id");

ALTER TABLE "soul_releases"
ADD CONSTRAINT "soul_releases_series_id_fkey"
FOREIGN KEY ("series_id") REFERENCES "soul_series"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "soul_pass_snapshots"
ADD CONSTRAINT "soul_pass_snapshots_series_id_fkey"
FOREIGN KEY ("series_id") REFERENCES "soul_series"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
