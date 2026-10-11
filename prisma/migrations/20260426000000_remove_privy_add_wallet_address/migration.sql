-- Remove Privy DID column from accounts and add a denormalized wallet_address
-- column for fast wallet-login lookup. Greenfield migration: dev environment,
-- no historical Privy-only users to preserve.
DROP INDEX IF EXISTS "accounts_privy_did_key";
ALTER TABLE "accounts" DROP COLUMN IF EXISTS "privy_did";

ALTER TABLE "accounts" ADD COLUMN "wallet_address" TEXT;
CREATE UNIQUE INDEX "accounts_wallet_address_key" ON "accounts"("wallet_address");
