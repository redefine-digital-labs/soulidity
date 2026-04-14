import 'dotenv/config'
import { PrismaClient } from '../web/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { syncArticleToPost } from '../src/shared/sync-article-post.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL not set')
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

const articles = await prisma.article.findMany({
  where: { status: 'published' },
  select: { id: true, titleZh: true },
  orderBy: { createdAt: 'asc' },
})

console.log(`Found ${articles.length} published articles to backfill`)

let synced = 0
let skipped = 0
let failed = 0

for (const article of articles) {
  try {
    const result = await syncArticleToPost(prisma, article.id)
    if (result.synced) {
      synced++
      console.log(`  + ${article.titleZh.slice(0, 40)}...`)
    } else {
      skipped++
    }
  } catch (err) {
    failed++
    console.error(`  ! Failed: ${article.titleZh.slice(0, 40)} — ${err instanceof Error ? err.message : err}`)
  }
}

console.log(`\nDone: ${synced} synced, ${skipped} skipped (already exist), ${failed} failed`)
await prisma.$disconnect()
