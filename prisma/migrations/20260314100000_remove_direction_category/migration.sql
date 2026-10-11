-- DropForeignKey
ALTER TABLE "articles" DROP CONSTRAINT IF EXISTS "articles_direction_id_fkey";

-- DropForeignKey
ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_direction_id_fkey";

-- DropForeignKey
ALTER TABLE "directions" DROP CONSTRAINT IF EXISTS "directions_category_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "articles_direction_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "posts_direction_id_idx";

-- Backfill: copy direction name_zh as tag onto posts before dropping
UPDATE "posts" p
SET tags = CASE
  WHEN p.tags IS NOT NULL AND p.tags != '' THEN p.tags || ',' || d.name_zh
  ELSE d.name_zh
END
FROM "directions" d
WHERE p.direction_id = d.id;

-- Backfill: copy direction name_zh as tag onto articles before dropping (JSON array format)
UPDATE "articles" a
SET tags = CASE
  WHEN a.tags IS NOT NULL AND a.tags != '' AND a.tags != '[]'
    THEN (a.tags::jsonb || to_jsonb(d.name_zh))::text
  ELSE jsonb_build_array(d.name_zh)::text
END
FROM "directions" d
WHERE a.direction_id = d.id;

-- AlterTable
ALTER TABLE "articles" DROP COLUMN IF EXISTS "direction_id";

-- AlterTable
ALTER TABLE "posts" DROP COLUMN IF EXISTS "direction_id";

-- DropTable
DROP TABLE IF EXISTS "directions";

-- DropTable
DROP TABLE IF EXISTS "categories";
