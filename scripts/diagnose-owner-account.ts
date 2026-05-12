import 'dotenv/config'
import { PrismaClient } from '../src/db/prisma-client.js'
import { PrismaPg } from '@prisma/adapter-pg'

const WALLET = process.argv[2]
if (!WALLET) throw new Error('usage: tsx scripts/diagnose-owner-account.ts <sui-address>')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const p = new PrismaClient({ adapter })

const lower = WALLET.toLowerCase()
const binding = await p.walletBinding.findFirst({
  where: { address: lower, chain: 'sui' },
  select: { memberId: true, member: { select: { id: true, displayName: true, kind: true, accountId: true } } },
})
if (!binding?.member) {
  console.log(JSON.stringify({ error: 'wallet not bound', wallet: lower }, null, 2))
  process.exit(0)
}

const accountId = binding.member.accountId
const agents = await p.member.findMany({
  where: { accountId, kind: 'agent' },
  select: {
    id: true,
    displayName: true,
    agentStatus: true,
    joinedAt: true,
    walletBindings: { where: { chain: 'sui' }, select: { address: true } },
  },
  orderBy: { joinedAt: 'asc' },
})

const ownedSouls = await p.soulAsset.findMany({
  where: { currentOwnerMemberId: binding.member.id },
  select: {
    onChainId: true,
    name: true,
    grantCapacity: true,
    activeGrantCount: true,
    updatedAt: true,
    contentVersions: {
      where: { kind: 3 },
      orderBy: { createdAtMs: 'desc' },
      take: 3,
      select: { name: true, versionIndex: true, isPublic: true, readModeMask: true, createdAtMs: true, createdAt: true },
    },
    grantRecords: {
      select: { granteeAddress: true, status: true, scopes: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    },
  },
  orderBy: { updatedAt: 'desc' },
  take: 5,
})

console.log(JSON.stringify({
  ownerMember: binding.member,
  accountId,
  agents: agents.map((a) => ({
    id: a.id,
    displayName: a.displayName,
    agentStatus: a.agentStatus,
    joinedAt: a.joinedAt,
    suiAddress: a.walletBindings[0]?.address ?? null,
  })),
  agentCount: agents.length,
  agentsBoundCount: agents.filter((a) => a.walletBindings.length > 0 && a.agentStatus === 'active').length,
  ownedSoulsCount: ownedSouls.length,
  ownedSouls,
}, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2))

await p.$disconnect()
