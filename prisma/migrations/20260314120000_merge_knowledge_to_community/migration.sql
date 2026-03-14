-- Step 1: Add source_url column to posts
ALTER TABLE "posts" ADD COLUMN "source_url" TEXT;

-- Step 2: Insert system member for knowledge bot
INSERT INTO "members" ("id", "tg_id", "tg_name", "display_name", "kind", "level", "joined_at")
VALUES (
  gen_random_uuid(),
  'SYSTEM_KB_BOT',
  '系统',
  '知识库',
  'system',
  1,
  NOW()
) ON CONFLICT ("tg_id") DO NOTHING;

-- Step 3: Migrate knowledge_entries to posts
INSERT INTO "posts" ("id", "member_id", "title", "content", "tags", "type", "status", "source_url", "created_at", "updated_at")
SELECT
  ke.id,
  (SELECT id FROM "members" WHERE "tg_id" = 'SYSTEM_KB_BOT' LIMIT 1),
  ke.title,
  ke.content,
  CONCAT_WS(',', ke.category, ke.content_type),
  'knowledge',
  'published',
  (SELECT ri.url FROM "knowledge_entry_sources" kes JOIN "raw_items" ri ON ri.id = kes.raw_item_id WHERE kes.entry_id = ke.id LIMIT 1),
  ke.created_at,
  ke.updated_at
FROM "knowledge_entries" ke;

-- Step 4: Drop knowledge tables
DROP TABLE IF EXISTS "knowledge_entry_sources";
DROP TABLE IF EXISTS "knowledge_entries";
