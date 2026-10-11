import { PrismaClient } from '../src/db/prisma-client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { allocateUniqueHandle, resolveHandleSeed } from '../web/lib/handle.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function main() {
  const members = await prisma.member.findMany({
    where: { handle: null, kind: 'human' },
    select: {
      id: true,
      tgName: true,
      displayName: true,
      account: { select: { email: true } },
    },
  })

  console.log(`Found ${members.length} human members missing a handle`)

  let assigned = 0
  for (const member of members) {
    const seed = resolveHandleSeed({
      displayName: member.displayName,
      tgName: member.tgName,
      email: member.account?.email ?? null,
    })

    const handle = await allocateUniqueHandle(seed, member.id, async (candidate) => {
      const existing = await prisma.member.findUnique({
        where: { handle: candidate },
        select: { id: true },
      })
      return !!existing
    })

    try {
      await prisma.member.update({ where: { id: member.id }, data: { handle } })
      assigned++
      console.log(`  → ${member.id} = @${handle}`)
    } catch (err) {
      console.error(`  ✗ ${member.id}: ${(err as Error).message}`)
    }
  }

  console.log(`Done. Assigned ${assigned}/${members.length} handles.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
