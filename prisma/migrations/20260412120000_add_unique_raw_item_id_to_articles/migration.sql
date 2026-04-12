-- Deduplicate: for each raw_item_id with duplicates, keep the "best" row:
--   1. Prefer articles referenced by publications (live/published data)
--   2. Among those (or if none), prefer the oldest by created_at
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
          a.created_at ASC
      ) AS rn
    FROM "articles" a
  ) ranked
  WHERE rn > 1
);

-- CreateIndex
CREATE UNIQUE INDEX "articles_raw_item_id_key" ON "articles"("raw_item_id");
