import 'dotenv/config'
import { PrismaClient } from '../src/db/prisma-client.js'
import { PrismaPg } from '@prisma/adapter-pg'

const ID = '0xf1e23e7d8fdc48ebbd9e2333ff56e0dd285f3e332a449b5de35c8178cb927869'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const p = new PrismaClient({ adapter })

const lower = ID.toLowerCase()

const asKiosk = await p.soulAsset.findFirst({
  where: { OR: [{ currentKioskId: lower }, { currentKioskCapOnChainId: lower }] },
  select: { onChainId: true, name: true, currentOwnerAddress: true, currentKioskId: true },
})

const asWallet = await p.walletBinding.findFirst({
  where: { address: lower },
  select: { memberId: true, address: true, chain: true, member: { select: { displayName: true, kind: true, accountId: true } } },
})

const asGrant = await p.soulGrantRecord.findFirst({
  where: { OR: [{ granteeAddress: lower }, { issuedByAddress: lower }, { onChainId: lower }, { soulOnChainId: lower }] },
  select: { onChainId: true, soulOnChainId: true, granteeAddress: true, status: true, scopes: true, createdAt: true },
})

const asCollection = await p.soulCollectionAsset.findFirst({
  where: { OR: [{ onChainId: lower }, { rightOnChainId: lower }, { currentHolderAddress: lower }] },
  select: { onChainId: true, name: true },
})

console.log(JSON.stringify({ asKiosk, asWallet, asGrant, asCollection }, null, 2))
await p.$disconnect()
