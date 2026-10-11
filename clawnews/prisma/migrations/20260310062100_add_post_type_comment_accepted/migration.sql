-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "is_accepted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'log';

-- CreateIndex
CREATE INDEX "posts_type_idx" ON "posts"("type");
