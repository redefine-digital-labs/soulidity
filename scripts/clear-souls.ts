import dotenv from 'dotenv'
dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

import { PrismaClient } from '../src/db/prisma-client.js'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set')
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function main() {
  const prep = await prisma.soulPreparedPurchase.deleteMany()
  const sync = await prisma.soulTxSync.deleteMany()
  const asset = await prisma.soulAsset.deleteMany()
  console.log('Deleted:', JSON.stringify({
    soulPreparedPurchase: prep.count,
    soulTxSync: sync.count,
    soulAsset: asset.count,
  }, null, 2))
}

main().finally(() => prisma.$disconnect())
