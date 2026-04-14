import { PrismaClient } from "../web/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const p = new PrismaClient({ adapter });
  const souls = await p.soulAsset.findMany({
    where: {},
    select: { name: true, onChainId: true, sealSidecar: true, listingStatus: true }
  });
  for (const s of souls) {
    console.log(`${s.name}: sidecar=${s.sealSidecar ? 'present' : 'NULL'} status=${s.listingStatus}`);
  }
  await p.$disconnect();
}
main().catch(console.error);
