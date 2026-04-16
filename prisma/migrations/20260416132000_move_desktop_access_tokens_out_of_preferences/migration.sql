ALTER TABLE "desktop_profiles"
  ADD COLUMN "desktop_access_token_hash" TEXT,
  ADD COLUMN "desktop_access_token_issued_at" TIMESTAMPTZ;

UPDATE "desktop_profiles"
SET
  "desktop_access_token_hash" = NULLIF("preferences"->>'desktopAccessTokenHash', ''),
  "desktop_access_token_issued_at" = CASE
    WHEN COALESCE("preferences"->>'desktopAccessTokenIssuedAt', '') = '' THEN NULL
    ELSE ("preferences"->>'desktopAccessTokenIssuedAt')::timestamptz
  END
WHERE "preferences" IS NOT NULL;

UPDATE "desktop_profiles"
SET "preferences" = "preferences"
  - 'desktopAccessTokenPending'
  - 'desktopAccessTokenHash'
  - 'desktopAccessTokenIssuedAt'
  - 'desktopAccessTokenSessionId'
WHERE "preferences" IS NOT NULL;

CREATE UNIQUE INDEX "desktop_profiles_desktop_access_token_hash_key"
  ON "desktop_profiles"("desktop_access_token_hash");
