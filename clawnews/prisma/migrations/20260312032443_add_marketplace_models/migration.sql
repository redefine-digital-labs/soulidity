-- CreateTable
CREATE TABLE "wallet_bindings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID NOT NULL,
    "chain" TEXT NOT NULL DEFAULT 'sui',
    "address" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "verified_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_bundles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seller_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "category" TEXT NOT NULL,
    "tags" TEXT[],
    "storage_bucket" TEXT NOT NULL DEFAULT 'agent-bundles',
    "storage_path" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "preview_images" TEXT[],
    "readme" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bundle_id" UUID NOT NULL,
    "seller_wallet_address" TEXT NOT NULL,
    "price_mist" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SUI',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_intents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "wallet_binding_id" UUID NOT NULL,
    "expected_price_mist" BIGINT NOT NULL,
    "recipient_address" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "tx_digest" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "wallet_binding_id" UUID NOT NULL,
    "purchase_intent_id" UUID NOT NULL,
    "price_mist" BIGINT NOT NULL,
    "tx_digest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bundle_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "wallet_binding_id" UUID,
    "access_type" TEXT NOT NULL DEFAULT 'download',
    "status" TEXT NOT NULL DEFAULT 'active',
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallet_bindings_member_id_chain_idx" ON "wallet_bindings"("member_id", "chain");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_bindings_chain_address_key" ON "wallet_bindings"("chain", "address");

-- CreateIndex
CREATE INDEX "agent_bundles_seller_id_status_idx" ON "agent_bundles"("seller_id", "status");

-- CreateIndex
CREATE INDEX "listings_bundle_id_status_idx" ON "listings"("bundle_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_intents_nonce_key" ON "purchase_intents"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_intents_tx_digest_key" ON "purchase_intents"("tx_digest");

-- CreateIndex
CREATE INDEX "purchase_intents_member_id_status_idx" ON "purchase_intents"("member_id", "status");

-- CreateIndex
CREATE INDEX "purchase_intents_listing_id_status_idx" ON "purchase_intents"("listing_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_purchase_intent_id_key" ON "orders"("purchase_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tx_digest_key" ON "orders"("tx_digest");

-- CreateIndex
CREATE INDEX "orders_buyer_id_created_at_idx" ON "orders"("buyer_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_order_id_key" ON "entitlements"("order_id");

-- CreateIndex
CREATE INDEX "entitlements_member_id_status_idx" ON "entitlements"("member_id", "status");

-- CreateIndex
CREATE INDEX "entitlements_bundle_id_status_idx" ON "entitlements"("bundle_id", "status");

-- AddForeignKey
ALTER TABLE "wallet_bindings" ADD CONSTRAINT "wallet_bindings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_bundles" ADD CONSTRAINT "agent_bundles_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "agent_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_intents" ADD CONSTRAINT "purchase_intents_wallet_binding_id_fkey" FOREIGN KEY ("wallet_binding_id") REFERENCES "wallet_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_wallet_binding_id_fkey" FOREIGN KEY ("wallet_binding_id") REFERENCES "wallet_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_purchase_intent_id_fkey" FOREIGN KEY ("purchase_intent_id") REFERENCES "purchase_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "agent_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_wallet_binding_id_fkey" FOREIGN KEY ("wallet_binding_id") REFERENCES "wallet_bindings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
