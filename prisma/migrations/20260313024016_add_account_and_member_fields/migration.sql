/*
  Warnings:

  - A unique constraint covering the columns `[api_key]` on the table `members` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "members" ADD COLUMN     "account_id" UUID,
ADD COLUMN     "api_key" TEXT,
ADD COLUMN     "display_name" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'human';

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "privy_did" TEXT,
    "tg_id" TEXT,
    "tg_name" TEXT,
    "avatar" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_privy_did_key" ON "accounts"("privy_did");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tg_id_key" ON "accounts"("tg_id");

-- CreateIndex
CREATE UNIQUE INDEX "members_api_key_key" ON "members"("api_key");

-- CreateIndex
CREATE INDEX "members_account_id_kind_idx" ON "members"("account_id", "kind");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
