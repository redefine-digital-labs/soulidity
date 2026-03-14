-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");
