import { PrismaClient } from '../generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function main() {
  const members = await prisma.member.findMany({
    where: { accountId: null },
    select: { id: true, tgId: true, tgName: true, avatar: true },
  })

  console.log(`Found ${members.length} members without accounts`)

  for (const member of members) {
    const account = await prisma.account.create({
      data: {
        tgId: member.tgId,
        tgName: member.tgName,
        avatar: member.avatar,
      },
    })

    await prisma.member.update({
      where: { id: member.id },
      data: {
        accountId: account.id,
        kind: 'human',
        displayName: member.tgName,
      },
    })

    console.log(`Migrated member ${member.id} → account ${account.id}`)
  }

  console.log('Done')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
