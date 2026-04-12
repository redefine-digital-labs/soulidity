-- Deduplicate: keep the earliest article per raw_item_id, delete later duplicates
DELETE FROM "articles"
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY raw_item_id ORDER BY created_at ASC) AS rn
    FROM "articles"
  ) ranked
  WHERE rn > 1
);

-- CreateIndex
CREATE UNIQUE INDEX "articles_raw_item_id_key" ON "articles"("raw_item_id");
