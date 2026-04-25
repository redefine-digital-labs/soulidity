-- Replace the sprite-specific staging table with a general-purpose
-- soul_upload_bindings table that the unified Vercel-Blob direct-upload
-- pipeline (token + from-blob routes) shares across persona-sprite and
-- soul-content (cover image / character / memory / skills) flows.
--
-- The previous table was committed in
--   20260425110000_add_soul_sprite_upload_bindings
-- and was only ever used by the persona-asset-panel sprite path; no
-- production data lives in it (binding rows are short-lived staging state
-- that get consumed within minutes of creation).

DROP TABLE IF EXISTS "soul_sprite_upload_bindings";

CREATE TABLE "soul_upload_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "nonce" text NOT NULL,
  "member_id" uuid NOT NULL,
  "blob_url" text NOT NULL,
  "pathname" text NOT NULL,
  "content_type" text NOT NULL,
  "kind" text NOT NULL,
  "upload_type" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "soul_upload_bindings_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "soul_upload_bindings_nonce_key"
  ON "soul_upload_bindings"("nonce");

CREATE UNIQUE INDEX "soul_upload_bindings_blob_url_key"
  ON "soul_upload_bindings"("blob_url");

CREATE INDEX "soul_upload_bindings_member_id_nonce_idx"
  ON "soul_upload_bindings"("member_id", "nonce");

CREATE INDEX "soul_upload_bindings_expires_at_idx"
  ON "soul_upload_bindings"("expires_at");
