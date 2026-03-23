CREATE TABLE "soul_tx_syncs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "route_key" TEXT NOT NULL,
    "tx_digest" TEXT NOT NULL,
    "actor_key" TEXT NOT NULL,
    "resource_key" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "soul_tx_syncs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "soul_tx_syncs_route_key_tx_digest_actor_key_key"
ON "soul_tx_syncs"("route_key", "tx_digest", "actor_key");

CREATE INDEX "soul_tx_syncs_resource_key_created_at_idx"
ON "soul_tx_syncs"("resource_key", "created_at" DESC);

CREATE TABLE "soul_prepared_purchases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_member_id" UUID NOT NULL,
    "series_on_chain_id" TEXT NOT NULL,
    "plan_on_chain_id" TEXT NOT NULL,
    "plan_type" TEXT NOT NULL,
    "release_on_chain_id" TEXT,
    "agent_address" TEXT NOT NULL,
    "amount_usdc" BIGINT NOT NULL,
    "tx_bytes_base64" TEXT NOT NULL,
    "tx_bytes_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "executed_at" TIMESTAMPTZ,
    "execution_tx_digest" TEXT,
    "result_status_code" INTEGER,
    "result_body" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "soul_prepared_purchases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "soul_prepared_purchases_tx_bytes_base64_size_check"
      CHECK (octet_length("tx_bytes_base64") <= 65536),
    CONSTRAINT "soul_prepared_purchases_agent_member_id_fkey"
      FOREIGN KEY ("agent_member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "soul_prepared_purchases_agent_member_id_expires_at_idx"
ON "soul_prepared_purchases"("agent_member_id", "expires_at");

CREATE INDEX "soul_prepared_purchases_series_on_chain_id_created_at_idx"
ON "soul_prepared_purchases"("series_on_chain_id", "created_at" DESC);

CREATE INDEX "soul_prepared_purchases_execution_tx_digest_idx"
ON "soul_prepared_purchases"("execution_tx_digest");
