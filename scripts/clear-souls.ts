import dotenv from 'dotenv'
dotenv.config({ path: new URL('../.env', import.meta.url).pathname })

import { PrismaClient } from '../generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set')
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function main() {
  const prep = await prisma.soulPreparedPurchase.deleteMany()
  const sync = await prisma.soulTxSync.deleteMany()
  const pass = await prisma.soulPassSnapshot.deleteMany()
  const rel = await prisma.soulRelease.deleteMany()
  const ser = await prisma.soulSeries.deleteMany()
  console.log('Deleted:', JSON.stringify({
    soulPreparedPurchase: prep.count,
    soulTxSync: sync.count,
    soulPassSnapshot: pass.count,
    soulRelease: rel.count,
    soulSeries: ser.count,
  }, null, 2))
}

main().finally(() => prisma.$disconnect())
