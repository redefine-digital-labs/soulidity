-- Deduplicate: for each raw_item_id with duplicates, keep the "best" row:
--   1. Prefer articles referenced by publications
--   2. Then prefer articles already linked to community posts
--   3. Then prefer rows already marked published / pipeline completed
--   4. Finally break ties by created_at
-- This avoids CASCADE-deleting live publication rows or orphaning posts.
DELETE FROM "articles"
WHERE id IN (
  SELECT id FROM (
    SELECT
      a.id,
      ROW_NUMBER() OVER (
        PARTITION BY a.raw_item_id
        ORDER BY
          CASE WHEN EXISTS (SELECT 1 FROM "publications" p WHERE p.article_id = a.id) THEN 0 ELSE 1 END,
          CASE WHEN EXISTS (SELECT 1 FROM "posts" po WHERE po.article_id = a.id) THEN 0 ELSE 1 END,
          CASE WHEN a.status = 'published' THEN 0 ELSE 1 END,
          CASE WHEN a.pipeline_status = 'completed' THEN 0 ELSE 1 END,
          a.created_at ASC
      ) AS rn
    FROM "articles" a
  ) ranked
  WHERE rn > 1
);

-- CreateIndex
CREATE UNIQUE INDEX "articles_raw_item_id_key" ON "articles"("raw_item_id");
