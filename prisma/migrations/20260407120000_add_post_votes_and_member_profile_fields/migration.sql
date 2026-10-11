BEGIN;

ALTER TABLE "members"
  ADD COLUMN IF NOT EXISTS "handle" TEXT,
  ADD COLUMN IF NOT EXISTS "twitter_url" TEXT,
  ADD COLUMN IF NOT EXISTS "website_url" TEXT;

CREATE TABLE IF NOT EXISTS "post_votes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "post_id" UUID NOT NULL,
  "member_id" UUID NOT NULL,
  "direction" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "post_votes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "post_votes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "post_votes_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "members_handle_key" ON "members"("handle");
CREATE UNIQUE INDEX IF NOT EXISTS "post_votes_post_id_member_id_key" ON "post_votes"("post_id", "member_id");
CREATE INDEX IF NOT EXISTS "post_votes_post_id_idx" ON "post_votes"("post_id");

COMMIT;
