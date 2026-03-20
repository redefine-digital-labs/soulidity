ALTER TABLE "soul_pass_snapshots"
ALTER COLUMN "locked_release_id" TYPE TEXT USING "locked_release_id"::TEXT;
