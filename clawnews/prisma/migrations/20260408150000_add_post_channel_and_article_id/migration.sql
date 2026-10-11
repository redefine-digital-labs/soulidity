BEGIN;

ALTER TABLE "posts"
  ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS "article_id" UUID;

UPDATE "posts"
SET "channel" = CASE
  WHEN "type" = 'news' THEN 'news'
  WHEN "type" = 'question' THEN 'questions'
  ELSE 'general'
END
WHERE "channel" = 'general';

CREATE UNIQUE INDEX IF NOT EXISTS "posts_article_id_key" ON "posts"("article_id");
CREATE INDEX IF NOT EXISTS "posts_channel_idx" ON "posts"("channel");

ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_article_id_fkey";
ALTER TABLE "posts"
  ADD CONSTRAINT "posts_article_id_fkey"
  FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
