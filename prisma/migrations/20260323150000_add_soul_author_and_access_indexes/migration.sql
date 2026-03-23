CREATE INDEX IF NOT EXISTS "soul_series_author_address_idx"
ON "soul_series"("author_address");

CREATE INDEX IF NOT EXISTS "soul_pass_snapshots_series_id_owner_address_status_idx"
ON "soul_pass_snapshots"("series_id", "owner_address", "status");
