ALTER TABLE "soul_assets"
ADD COLUMN IF NOT EXISTS "persona_kind" TEXT NOT NULL DEFAULT 'characters';

UPDATE "soul_assets"
SET "persona_kind" = CASE
  WHEN EXISTS (
    SELECT 1
    FROM unnest("tags") AS tag
    WHERE regexp_replace(lower(tag), '[[:space:]_]+', '-', 'g') LIKE ANY (
      ARRAY[
        'ai', 'ai-%', '%-ai', '%-ai-%',
        'agent', 'agent-%', '%-agent', '%-agent-%',
        'bot', 'bot-%', '%-bot', '%-bot-%',
        'trading', 'trading-%', '%-trading', '%-trading-%',
        'research', 'research-%', '%-research', '%-research-%',
        'infrastructure', 'infrastructure-%', '%-infrastructure', '%-infrastructure-%',
        'automation', 'automation-%', '%-automation', '%-automation-%',
        'defi', 'defi-%', '%-defi', '%-defi-%',
        'on-chain', 'on-chain-%', '%-on-chain', '%-on-chain-%'
      ]
    )
  ) THEN 'agents'
  ELSE 'characters'
END;

ALTER TABLE "soul_assets"
DROP CONSTRAINT IF EXISTS "soul_assets_persona_kind_check";

ALTER TABLE "soul_assets"
ADD CONSTRAINT "soul_assets_persona_kind_check"
CHECK ("persona_kind" IN ('agents', 'characters'));

CREATE INDEX IF NOT EXISTS "soul_assets_tags_gin_idx"
ON "soul_assets" USING GIN ("tags");

CREATE INDEX IF NOT EXISTS "soul_assets_listing_updated_idx"
ON "soul_assets" ("listing_status", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "soul_assets_listing_price_idx"
ON "soul_assets" ("listing_status", "listed_price_atomic");

CREATE INDEX IF NOT EXISTS "soul_assets_listing_grants_idx"
ON "soul_assets" ("listing_status", "active_grant_count" DESC);

CREATE INDEX IF NOT EXISTS "soul_assets_listing_persona_idx"
ON "soul_assets" ("listing_status", "persona_kind");

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping pg_trgm extension creation because the current role lacks privileges.';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "soul_assets_listed_name_trgm_idx" ON "soul_assets" USING GIN ("name" gin_trgm_ops) WHERE "listing_status" = ''listed''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS "soul_assets_listed_description_trgm_idx" ON "soul_assets" USING GIN ("description" gin_trgm_ops) WHERE "listing_status" = ''listed''';
  END IF;
END $$;
