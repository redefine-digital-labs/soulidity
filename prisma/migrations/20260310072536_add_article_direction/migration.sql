-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "direction_id" UUID;

-- CreateIndex
CREATE INDEX "articles_direction_id_idx" ON "articles"("direction_id");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_direction_id_fkey" FOREIGN KEY ("direction_id") REFERENCES "directions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
