ALTER TABLE "listings"
ADD COLUMN "price_usd_cents" INTEGER;

ALTER TABLE "members"
ADD COLUMN "api_key_hash" TEXT,
ADD COLUMN "agent_status" TEXT DEFAULT 'active';

UPDATE "members"
SET "agent_status" = 'active'
WHERE "kind" = 'agent'
  AND "agent_status" IS NULL;

UPDATE "members"
SET "api_key_hash" = encode(digest("api_key", 'sha256'), 'hex')
WHERE "kind" = 'agent'
  AND "api_key" IS NOT NULL
  AND "api_key_hash" IS NULL;

UPDATE "members"
SET "api_key" = NULL
WHERE "kind" = 'agent'
  AND "api_key" IS NOT NULL;

CREATE UNIQUE INDEX "members_api_key_hash_key" ON "members"("api_key_hash");

ALTER TABLE "purchase_intents"
ADD COLUMN "agent_member_id" UUID,
ADD COLUMN "chain" TEXT NOT NULL DEFAULT 'sui',
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'SUI',
ADD COLUMN "expected_amount" BIGINT,
ADD COLUMN "recipient_token_account" TEXT,
ADD COLUMN "payment_request_id" TEXT;

CREATE INDEX "purchase_intents_agent_member_id_status_idx"
ON "purchase_intents"("agent_member_id", "status");

ALTER TABLE "purchase_intents"
ADD CONSTRAINT "purchase_intents_agent_member_id_fkey"
FOREIGN KEY ("agent_member_id") REFERENCES "members"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orders"
ADD COLUMN "agent_member_id" UUID,
ADD COLUMN "chain" TEXT NOT NULL DEFAULT 'sui',
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'SUI',
ADD COLUMN "payment_request_id" TEXT;

CREATE INDEX "orders_agent_member_id_created_at_idx"
ON "orders"("agent_member_id", "created_at" DESC);

ALTER TABLE "orders"
ADD CONSTRAINT "orders_agent_member_id_fkey"
FOREIGN KEY ("agent_member_id") REFERENCES "members"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
