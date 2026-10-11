BEGIN;

ALTER TABLE "posts"
  ADD COLUMN IF NOT EXISTS "tags_v2" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "posts" AS post
SET "tags_v2" = COALESCE(
  ARRAY(
    SELECT normalized_tag
    FROM (
      SELECT
        NULLIF(BTRIM(raw.tag), '') AS normalized_tag,
        MIN(raw.ordinality) AS first_ordinality
      FROM unnest(string_to_array(post."tags", ',')) WITH ORDINALITY AS raw(tag, ordinality)
      GROUP BY 1
    ) normalized_tags
    WHERE normalized_tag IS NOT NULL
    ORDER BY first_ordinality
  ),
  ARRAY[]::TEXT[]
)
WHERE post."tags" IS NOT NULL
  AND BTRIM(post."tags") <> '';

ALTER TABLE "posts" DROP COLUMN "tags";
ALTER TABLE "posts" RENAME COLUMN "tags_v2" TO "tags";

CREATE INDEX IF NOT EXISTS "posts_tags_gin_idx" ON "posts" USING GIN ("tags");

COMMIT;
