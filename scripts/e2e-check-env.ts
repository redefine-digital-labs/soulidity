import { PrismaClient } from "../web/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const p = new PrismaClient({ adapter });

  const accounts = await p.account.findMany({
    where: { email: { in: ["ithinco@gmail.com", "tenxhunter@gmail.com"] } },
    include: { members: { include: { walletBindings: true } } }
  });
  for (const a of accounts) {
    console.log(`Account: ${a.email}`);
    for (const m of a.members) {
      console.log(`  Member: ${m.id} kind=${m.kind} hasApiKey=${!!m.apiKey}`);
      for (const w of m.walletBindings) {
        console.log(`    Wallet: ${w.address} chain=${w.chain}`);
      }
    }
  }

  const agents = await p.member.findMany({
    where: { kind: "agent", apiKey: { not: null } },
    include: { walletBindings: true }
  });
  console.log(`\nAgents: ${agents.length}`);
  for (const a of agents) {
    console.log(`  Agent: ${a.id} key=${a.apiKey?.slice(0, 10)}... name=${a.displayName}`);
    for (const w of a.walletBindings) {
      console.log(`    Wallet: ${w.address}`);
    }
  }

  const souls = await p.soulAsset.findMany({
    select: { onChainId: true, name: true, listingStatus: true, stateOnChainId: true, memoryOnChainId: true }
  });
  console.log(`\nSoul assets: ${souls.length}`);
  for (const s of souls) {
    console.log(`  ${s.name}: onChainId=${s.onChainId} status=${s.listingStatus} stateId=${s.stateOnChainId} memoryId=${s.memoryOnChainId}`);
  }
  await p.$disconnect();
}

main().catch(console.error);
