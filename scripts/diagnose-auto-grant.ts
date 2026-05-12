import 'dotenv/config'
import { PrismaClient } from '../src/db/prisma-client.js'
import { PrismaPg } from '@prisma/adapter-pg'

const SOUL_ID = process.argv[2]
if (!SOUL_ID) throw new Error('usage: tsx scripts/diagnose-auto-grant.ts <soul-on-chain-id>')

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL not set')
const adapter = new PrismaPg({ connectionString })
const p = new PrismaClient({ adapter })

const soul = await p.soulAsset.findFirst({
  where: {
    OR: [
      { onChainId: SOUL_ID.toLowerCase() },
      { stateOnChainId: SOUL_ID.toLowerCase() },
      { contentOnChainId: SOUL_ID.toLowerCase() },
      { paidAccessListOnChainId: SOUL_ID.toLowerCase() },
    ],
  },
  select: {
    id: true,
    onChainId: true,
    stateOnChainId: true,
    name: true,
    currentOwnerMemberId: true,
    currentOwnerAddress: true,
    grantCapacity: true,
    activeGrantCount: true,
    grantRecords: {
      select: {
        granteeAddress: true,
        status: true,
        scopes: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    },
    contentVersions: {
      where: { kind: 3 },
      select: { name: true, versionIndex: true, isPublic: true, readModeMask: true, createdAtMs: true },
      orderBy: { versionIndex: 'desc' },
      take: 5,
    },
  },
})

if (!soul) {
  console.log(JSON.stringify({ error: 'soul not found', searchedId: SOUL_ID }, null, 2))
  process.exit(0)
}

const ownerMember = soul.currentOwnerMemberId
  ? await p.member.findUnique({
      where: { id: soul.currentOwnerMemberId },
      select: { id: true, displayName: true, accountId: true, kind: true },
    })
  : null

const accountAgents = ownerMember?.accountId
  ? await p.member.findMany({
      where: { accountId: ownerMember.accountId, kind: 'agent' },
      select: {
        id: true,
        displayName: true,
        agentStatus: true,
        walletBindings: {
          where: { chain: 'sui' },
          select: { address: true },
          take: 1,
        },
      },
      orderBy: { joinedAt: 'asc' },
    })
  : []

console.log(JSON.stringify({
  soul: {
    onChainId: soul.onChainId,
    name: soul.name,
    ownerAddress: soul.currentOwnerAddress,
    grantCapacity: soul.grantCapacity,
    activeGrantCount: soul.activeGrantCount,
  },
  owner: ownerMember,
  recentSprites: soul.contentVersions,
  grants: soul.grantRecords,
  accountAgents: accountAgents.map((a) => ({
    id: a.id,
    displayName: a.displayName,
    agentStatus: a.agentStatus,
    suiAddress: a.walletBindings[0]?.address ?? null,
  })),
}, null, 2))

await p.$disconnect()
