-- DropIndex
DROP INDEX IF EXISTS "soul_assets_category_idx";

-- AlterTable
ALTER TABLE "soul_assets" DROP COLUMN "category";
