-- Cut Soul runtime over from series/release/pass mirrors to the single-object Soul asset model.
-- News-domain tables such as raw_items/articles/publications are intentionally untouched.

-- DropForeignKey
ALTER TABLE "soul_pass_snapshots" DROP CONSTRAINT "soul_pass_snapshots_owner_member_id_fkey";

-- DropForeignKey
ALTER TABLE "soul_pass_snapshots" DROP CONSTRAINT "soul_pass_snapshots_series_id_fkey";

-- DropForeignKey
ALTER TABLE "soul_releases" DROP CONSTRAINT "soul_releases_series_id_fkey";

-- DropForeignKey
ALTER TABLE "soul_series" DROP CONSTRAINT "soul_series_author_member_id_fkey";

-- DropForeignKey
ALTER TABLE "soul_series" DROP CONSTRAINT "soul_series_latest_release_id_fkey";

-- DropIndex
DROP INDEX "soul_prepared_purchases_series_on_chain_id_created_at_idx";

-- Legacy prepared purchases target the removed series/release/pass runtime and cannot be backfilled
-- into the single-object Soul purchase shape. Purge them before adding new required columns so
-- non-empty development databases can still apply this cutover.
TRUNCATE TABLE "soul_prepared_purchases";

-- AlterTable
ALTER TABLE "soul_prepared_purchases"
DROP COLUMN "amount_usdc",
DROP COLUMN "pass_on_chain_id",
DROP COLUMN "plan_on_chain_id",
DROP COLUMN "plan_type",
DROP COLUMN "release_on_chain_id",
DROP COLUMN "series_on_chain_id",
ADD COLUMN "price_sui" DECIMAL(20,0) NOT NULL,
ADD COLUMN "seller_kiosk_id" TEXT NOT NULL,
ADD COLUMN "soul_on_chain_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "soul_pass_snapshots";

-- DropTable
DROP TABLE "soul_releases";

-- DropTable
DROP TABLE "soul_series";

-- CreateTable
CREATE TABLE "soul_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "on_chain_id" TEXT NOT NULL,
    "creator_member_id" UUID,
    "creator_address" TEXT NOT NULL,
    "current_owner_member_id" UUID,
    "current_owner_address" TEXT NOT NULL,
    "seller_kiosk_id" TEXT,
    "listed_price_sui" DECIMAL(20,0),
    "listing_status" TEXT NOT NULL DEFAULT 'held',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "metadata_ref" TEXT,
    "content_blob_id" TEXT NOT NULL,
    "content_blob_object_id" TEXT NOT NULL,
    "seal_sidecar" JSONB,
    "category" TEXT NOT NULL,
    "tags" TEXT[],
    "preview_images" TEXT[],
    "readme" TEXT,
    "agent_grant_address" TEXT,
    "agent_access_cap_on_chain_id" TEXT,
    "grant_version" TEXT NOT NULL DEFAULT '0',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "soul_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "soul_assets_on_chain_id_key" ON "soul_assets"("on_chain_id");

-- CreateIndex
CREATE UNIQUE INDEX "soul_assets_agent_access_cap_on_chain_id_key" ON "soul_assets"("agent_access_cap_on_chain_id");

-- CreateIndex
CREATE INDEX "soul_assets_creator_member_id_listing_status_idx" ON "soul_assets"("creator_member_id", "listing_status");

-- CreateIndex
CREATE INDEX "soul_assets_creator_address_idx" ON "soul_assets"("creator_address");

-- CreateIndex
CREATE INDEX "soul_assets_current_owner_member_id_listing_status_idx" ON "soul_assets"("current_owner_member_id", "listing_status");

-- CreateIndex
CREATE INDEX "soul_assets_current_owner_address_listing_status_idx" ON "soul_assets"("current_owner_address", "listing_status");

-- CreateIndex
CREATE INDEX "soul_assets_category_idx" ON "soul_assets"("category");

-- CreateIndex
CREATE INDEX "soul_assets_created_at_idx" ON "soul_assets"("created_at" DESC);

-- CreateIndex
CREATE INDEX "soul_prepared_purchases_soul_on_chain_id_created_at_idx" ON "soul_prepared_purchases"("soul_on_chain_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "soul_assets" ADD CONSTRAINT "soul_assets_creator_member_id_fkey"
FOREIGN KEY ("creator_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "soul_assets" ADD CONSTRAINT "soul_assets_current_owner_member_id_fkey"
FOREIGN KEY ("current_owner_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
