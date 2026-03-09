-- CreateTable
CREATE TABLE "knowledge_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'raw',
    "merged_into_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_entry_sources" (
    "entry_id" UUID NOT NULL,
    "raw_item_id" UUID NOT NULL,

    CONSTRAINT "knowledge_entry_sources_pkey" PRIMARY KEY ("entry_id","raw_item_id")
);

-- CreateIndex
CREATE INDEX "knowledge_entries_category_idx" ON "knowledge_entries"("category");

-- CreateIndex
CREATE INDEX "knowledge_entries_content_type_idx" ON "knowledge_entries"("content_type");

-- CreateIndex
CREATE INDEX "knowledge_entries_status_idx" ON "knowledge_entries"("status");

-- AddForeignKey
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "knowledge_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_entry_sources" ADD CONSTRAINT "knowledge_entry_sources_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "knowledge_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_entry_sources" ADD CONSTRAINT "knowledge_entry_sources_raw_item_id_fkey" FOREIGN KEY ("raw_item_id") REFERENCES "raw_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
