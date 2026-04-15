import 'dotenv/config'
import { createPrisma } from './db/database.js'

const p = createPrisma()

const statuses = await p.$queryRawUnsafe(`SELECT status, count(*)::int as cnt, max("createdAt") as latest FROM "RawItem" GROUP BY status ORDER BY cnt DESC`)
console.log('=== RawItem by status ===')
console.table(statuses)

const artStatuses = await p.$queryRawUnsafe(`SELECT status, count(*)::int as cnt, max("createdAt") as latest FROM "Article" GROUP BY status ORDER BY cnt DESC`)
console.log('=== Article by status ===')
console.table(artStatuses)

const recentX = await p.$queryRawUnsafe(`SELECT status, count(*)::int as cnt FROM "RawItem" WHERE "sourceType" = 'x' GROUP BY status ORDER BY cnt DESC`)
console.log('=== X RawItems by status ===')
console.table(recentX)

const cState = await p.collectorState.findMany()
console.log('=== Collector States ===')
for (const s of cState) {
  console.log(s.source, JSON.stringify({
    lastPostedAt: s.lastPostedAt,
    lastTweetId: s.lastTweetId,
    updatedAt: s.updatedAt,
  }))
}

const lastArticle = await p.article.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, titleZh: true, status: true, createdAt: true } })
console.log('=== Latest articles ===')
console.table(lastArticle)

const lastPub = await p.publication.findMany({ orderBy: { publishedAt: 'desc' }, take: 3, select: { id: true, channel: true, publishedAt: true } })
console.log('=== Latest publications ===')
console.table(lastPub)

const lastRaw = await p.rawItem.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, sourceType: true, title: true, status: true, createdAt: true } })
console.log('=== Latest 10 raw items ===')
console.table(lastRaw)

await p.$disconnect()
