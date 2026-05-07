-- Desktop Pet Identity Split — hard cut.
--
-- Splits desktop pet identity (agent address + token + active source) out of
-- the account-level `desktop_profiles` row into a per-pet `desktop_pets` row.
-- Adds durable rotation fields on `members` so agent API key rotations can
-- survive a desktop crash mid-rotation without invalidating the active key.
-- Adds `purpose` to `wallet_challenges` so login / agent-join / desktop-link
-- nonces no longer share a namespace.
--
-- See docs/plans/2026-05-07-desktop-pet-binding.md §A.

-- ── 1. Legacy data guard ────────────────────────────────────────────
-- This migration drops legacy desktop columns. If any of them are still
-- populated we abort instead of silently losing data; the operator must
-- run an explicit backfill plan first. On a clean dev DB this guard is
-- a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "desktop_profiles"
    WHERE "agent_address" IS NOT NULL
       OR "desktop_access_token_hash" IS NOT NULL
       OR "active_source_type" IS NOT NULL
       OR "active_source_ref" IS NOT NULL
       OR "last_synced_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'desktop_profiles contains legacy desktop auth/source data; run explicit backfill before desktop_pet_identity_split';
  END IF;
END $$;

-- ── 2. Create desktop_pets ──────────────────────────────────────────
CREATE TABLE "desktop_pets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "agent_address" TEXT NOT NULL,
    "agent_member_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "desktop_access_token_hash" TEXT,
    "desktop_access_token_issued_at" TIMESTAMPTZ,
    "active_source_type" TEXT,
    "active_source_ref" TEXT,
    "last_synced_at" TIMESTAMPTZ,
    "last_seen_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desktop_pets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "desktop_pets_agent_member_id_key" ON "desktop_pets"("agent_member_id");
CREATE UNIQUE INDEX "desktop_pets_desktop_access_token_hash_key" ON "desktop_pets"("desktop_access_token_hash");
CREATE UNIQUE INDEX "desktop_pets_account_agent_address_key" ON "desktop_pets"("account_id", "agent_address");
CREATE INDEX "desktop_pets_account_id_updated_at_idx" ON "desktop_pets"("account_id", "updated_at" DESC);
CREATE INDEX "desktop_pets_account_active_source_idx" ON "desktop_pets"("account_id", "active_source_type", "active_source_ref");
CREATE INDEX "desktop_pets_agent_address_idx" ON "desktop_pets"("agent_address");

ALTER TABLE "desktop_pets"
  ADD CONSTRAINT "desktop_pets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "desktop_pets_agent_member_id_fkey" FOREIGN KEY ("agent_member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 3. Members: durable agent API key rotation fields ───────────────
ALTER TABLE "members"
  ADD COLUMN "api_key_rotation_id" TEXT,
  ADD COLUMN "pending_api_key_hash" TEXT,
  ADD COLUMN "pending_api_key_rotation_id" TEXT,
  ADD COLUMN "pending_api_key_rotation_expires_at" TIMESTAMPTZ;

CREATE UNIQUE INDEX "members_api_key_rotation_id_key" ON "members"("api_key_rotation_id");
CREATE UNIQUE INDEX "members_pending_api_key_rotation_id_key" ON "members"("pending_api_key_rotation_id");

-- ── 4. Wallet challenge purpose ─────────────────────────────────────
ALTER TABLE "wallet_challenges"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'login';

CREATE INDEX "wallet_challenges_purpose_address_expires_at_idx" ON "wallet_challenges"("purpose", "address", "expires_at");

-- ── 5. Clear stale challenges so legacy nonces are not re-used as login ─
DELETE FROM "wallet_challenges";

-- ── 6. Drop legacy desktop_profiles columns ─────────────────────────
DROP INDEX IF EXISTS "desktop_profiles_active_source_type_active_source_ref_idx";
DROP INDEX IF EXISTS "desktop_profiles_desktop_access_token_hash_key";

ALTER TABLE "desktop_profiles"
  DROP COLUMN "agent_address",
  DROP COLUMN "desktop_access_token_hash",
  DROP COLUMN "desktop_access_token_issued_at",
  DROP COLUMN "active_source_type",
  DROP COLUMN "active_source_ref",
  DROP COLUMN "last_synced_at";
