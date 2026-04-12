-- AlterTable
ALTER TABLE "soul_assets" ADD COLUMN "assets_on_chain_id" TEXT,
ADD COLUMN "access_list_on_chain_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "soul_assets_assets_on_chain_id_key" ON "soul_assets"("assets_on_chain_id");
CREATE UNIQUE INDEX "soul_assets_access_list_on_chain_id_key" ON "soul_assets"("access_list_on_chain_id");

-- CreateTable
CREATE TABLE "soul_asset_version_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "soul_on_chain_id" TEXT NOT NULL,
    "assets_on_chain_id" TEXT NOT NULL,
    "asset_name" TEXT NOT NULL,
    "version_index" INTEGER NOT NULL,
    "asset_type" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "blob_object_id" TEXT NOT NULL,
    "blob_id" TEXT,
    "seal_sidecar" JSONB,
    "created_at_ms" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "soul_asset_version_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_access_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "soul_on_chain_id" TEXT NOT NULL,
    "access_list_on_chain_id" TEXT NOT NULL,
    "grantee_address" TEXT NOT NULL,
    "scope_mask" INTEGER NOT NULL,
    "price_paid_atomic" BIGINT NOT NULL,
    "granted_at_ms" BIGINT NOT NULL,
    "expires_at_ms" BIGINT,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_access_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "soul_asset_version_unique" ON "soul_asset_version_records"("assets_on_chain_id", "asset_name", "version_index");
CREATE INDEX "soul_asset_version_records_soul_on_chain_id_asset_name_vers_idx" ON "soul_asset_version_records"("soul_on_chain_id", "asset_name", "version_index" DESC);

CREATE UNIQUE INDEX "content_access_unique" ON "content_access_records"("access_list_on_chain_id", "grantee_address");
CREATE INDEX "content_access_records_soul_on_chain_id_idx" ON "content_access_records"("soul_on_chain_id");
CREATE INDEX "content_access_records_grantee_address_idx" ON "content_access_records"("grantee_address");

-- AddForeignKey
ALTER TABLE "soul_asset_version_records" ADD CONSTRAINT "soul_asset_version_records_soul_on_chain_id_fkey" FOREIGN KEY ("soul_on_chain_id") REFERENCES "soul_assets"("on_chain_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_access_records" ADD CONSTRAINT "content_access_records_soul_on_chain_id_fkey" FOREIGN KEY ("soul_on_chain_id") REFERENCES "soul_assets"("on_chain_id") ON DELETE CASCADE ON UPDATE CASCADE;
