UPDATE "soul_series" AS series
SET "author_member_id" = NULL
WHERE "author_member_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "members" AS member
    WHERE member."id" = series."author_member_id"
  );

UPDATE "soul_series" AS series
SET "latest_release_id" = NULL
WHERE "latest_release_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "soul_releases" AS release
    WHERE release."id" = series."latest_release_id"
  );

UPDATE "soul_pass_snapshots" AS pass
SET "owner_member_id" = NULL
WHERE "owner_member_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "members" AS member
    WHERE member."id" = pass."owner_member_id"
  );

UPDATE "settlement_events" AS event
SET "payer_member_id" = NULL
WHERE "payer_member_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "members" AS member
    WHERE member."id" = event."payer_member_id"
  );

ALTER TABLE "soul_series"
ADD CONSTRAINT "soul_series_author_member_id_fkey"
FOREIGN KEY ("author_member_id") REFERENCES "members"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "soul_series"
ADD CONSTRAINT "soul_series_latest_release_id_fkey"
FOREIGN KEY ("latest_release_id") REFERENCES "soul_releases"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "soul_pass_snapshots"
ADD CONSTRAINT "soul_pass_snapshots_owner_member_id_fkey"
FOREIGN KEY ("owner_member_id") REFERENCES "members"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "settlement_events"
ADD CONSTRAINT "settlement_events_payer_member_id_fkey"
FOREIGN KEY ("payer_member_id") REFERENCES "members"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "soul_releases_series_id_version_key"
ON "soul_releases"("series_id", "version");

CREATE INDEX "soul_pass_snapshots_series_id_agent_grant_status_idx"
ON "soul_pass_snapshots"("series_id", "agent_grant", "status");

CREATE INDEX "settlement_events_settlement_status_relayer_attempts_created_at_idx"
ON "settlement_events"("settlement_status", "relayer_attempts", "created_at");

CREATE INDEX "settlement_events_series_on_chain_id_idx"
ON "settlement_events"("series_on_chain_id");
