-- desktop_mint_handoffs: one-shot handoff envelope from the desktop
-- "Mint By Web" flow to the web /create page.
--
-- Issued by desktop POST /api/desktop/mint-handoff (auth: dtk_* bearer
-- via requireDesktopIdentity) and consumed once by web GET
-- /api/desktop/mint-handoff/[token] (auth: web session cookie; the
-- accountId on the row must equal the requester's accountId).
--
-- payload is JSONB so the web hydrate route can pull text fields and
-- inline base64 blobs (cover image dataURL, skills.zip base64) without
-- a separate blob store. Rows expire 5 minutes after creation; pruning
-- is opportunistic (DELETE WHERE expires_at < now()) — the read path
-- ignores rows past expires_at and only the most recent unexpired row
-- per accountId is meaningful for a hand-off.
CREATE TABLE "desktop_mint_handoffs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,

    CONSTRAINT "desktop_mint_handoffs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "desktop_mint_handoffs_token_key" ON "desktop_mint_handoffs"("token");

CREATE INDEX "desktop_mint_handoffs_account_id_created_at_idx" ON "desktop_mint_handoffs"("account_id", "created_at" DESC);

CREATE INDEX "desktop_mint_handoffs_expires_at_idx" ON "desktop_mint_handoffs"("expires_at");

ALTER TABLE "desktop_mint_handoffs"
    ADD CONSTRAINT "desktop_mint_handoffs_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
