-- AlterTable: update skills table for ClawHub data
ALTER TABLE "skills" DROP COLUMN IF EXISTS "name";
ALTER TABLE "skills" DROP COLUMN IF EXISTS "description";
ALTER TABLE "skills" DROP COLUMN IF EXISTS "emoji";
ALTER TABLE "skills" DROP COLUMN IF EXISTS "github_url";

ALTER TABLE "skills" ADD COLUMN "slug" TEXT NOT NULL DEFAULT '';
ALTER TABLE "skills" ADD COLUMN "display_name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "skills" ADD COLUMN "summary" TEXT NOT NULL DEFAULT '';
ALTER TABLE "skills" ADD COLUMN "version" TEXT NOT NULL DEFAULT '1.0.0';
ALTER TABLE "skills" ADD COLUMN "downloads" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "skills" ADD COLUMN "stars" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "skills" ADD COLUMN "versions" INTEGER NOT NULL DEFAULT 1;

-- Remove old defaults
ALTER TABLE "skills" ALTER COLUMN "slug" DROP DEFAULT;
ALTER TABLE "skills" ALTER COLUMN "display_name" DROP DEFAULT;
ALTER TABLE "skills" ALTER COLUMN "summary" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "skills_slug_key" ON "skills"("slug");
CREATE INDEX "skills_downloads_idx" ON "skills"("downloads" DESC);
CREATE INDEX "skills_stars_idx" ON "skills"("stars" DESC);

-- Drop old unique index on name
DROP INDEX IF EXISTS "skills_name_key";
