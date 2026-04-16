import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL not set');
const adapter = new PrismaPg({ connectionString });
const p = new PrismaClient({ adapter });

const members = await p.member.findMany({
  where: { kind: { in: ['human', 'agent'] } },
  include: { walletBindings: true },
  orderBy: { joinedAt: 'asc' },
  take: 10,
});
for (const m of members) {
  const wb = m.walletBindings[0];
  console.log(m.kind, m.displayName || m.tgName || m.id.slice(0,8), wb?.address?.slice(0,10)+'...' || 'no-wallet', m.apiKeyHash ? 'has-api-key' : '');
}
const souls = await p.soulAsset.count();
console.log('Soul assets remaining:', souls);
await p.$disconnect();
