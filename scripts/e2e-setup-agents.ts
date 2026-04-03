import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash } from "node:crypto";

function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const p = new PrismaClient({ adapter });

  // Agent Alpha: wallet 0x3b82...8610, API key sk-ea27...4f
  const alphaKey = "sk-ea27c27dbedf3e46ef857f21e73b4238a8498f04ca432b4f";
  const alphaHash = hashApiKey(alphaKey);

  // Agent Beta: wallet 0x7ef4...8790, API key sk-c264...c3
  const betaKey = "sk-c264016082af57dda7a64f15bb9219f2507d398ac56d66c3";
  const betaHash = hashApiKey(betaKey);

  // Find agent members by wallet address
  const alphaWallet = await p.walletBinding.findFirst({
    where: { address: { startsWith: "0x3b82" } },
    select: { memberId: true, address: true }
  });

  const betaWallet = await p.walletBinding.findFirst({
    where: { address: { startsWith: "0x7ef4" } },
    select: { memberId: true, address: true }
  });

  if (!alphaWallet) {
    console.error("Agent Alpha wallet not found (0x3b82...)");
    process.exit(1);
  }
  if (!betaWallet) {
    console.error("Agent Beta wallet not found (0x7ef4...)");
    process.exit(1);
  }

  console.log(`Agent Alpha: member=${alphaWallet.memberId}, wallet=${alphaWallet.address}`);
  console.log(`Agent Beta:  member=${betaWallet.memberId}, wallet=${betaWallet.address}`);

  // Set API key hashes + activate
  await p.member.update({
    where: { id: alphaWallet.memberId },
    data: { apiKey: null, apiKeyHash: alphaHash, agentStatus: "active" }
  });
  console.log(`Agent Alpha: apiKeyHash set (${alphaHash.slice(0, 10)}...)`);

  await p.member.update({
    where: { id: betaWallet.memberId },
    data: { apiKey: null, apiKeyHash: betaHash, agentStatus: "active" }
  });
  console.log(`Agent Beta:  apiKeyHash set (${betaHash.slice(0, 10)}...)`);

  // Verify
  const alpha = await p.member.findUnique({ where: { id: alphaWallet.memberId }, select: { apiKeyHash: true, agentStatus: true, kind: true } });
  const beta = await p.member.findUnique({ where: { id: betaWallet.memberId }, select: { apiKeyHash: true, agentStatus: true, kind: true } });
  console.log(`\nVerification:`);
  console.log(`  Alpha: kind=${alpha?.kind} status=${alpha?.agentStatus} hasHash=${!!alpha?.apiKeyHash}`);
  console.log(`  Beta:  kind=${beta?.kind} status=${beta?.agentStatus} hasHash=${!!beta?.apiKeyHash}`);

  await p.$disconnect();
}

main().catch(console.error);
