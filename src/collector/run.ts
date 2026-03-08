import type { PrismaClient } from '../db/database.js'
import { collectRss } from './rss.js'
import { collectGithub } from './github.js'
import { scoreItem } from './score.js'
import { isDuplicate } from './dedup.js'
import { insertRawItem } from '../db/database.js'
import type { CollectedItem } from './types.js'

export async function runCollectors(prisma: PrismaClient, collectors: Array<() => Promise<CollectedItem[]>>): Promise<{ total: number; inserted: number; skipped: number }> {
  let total = 0
  let inserted = 0
  let skipped = 0

  for (const collector of collectors) {
    const items = await collector()
    total += items.length

    for (const item of items) {
      const dedup = await isDuplicate(prisma, item)
      if (dedup.duplicate) {
        console.log(`  skipped (similar to ${dedup.matchedId}): ${item.title}`)
        skipped++
        continue
      }

      const score = scoreItem(item.title, item.content)
      const id = await insertRawItem(prisma, {
        source_type: item.source_type,
        source_name: item.source_name,
        title: item.title,
        url: item.url,
        title_hash: dedup.hash,
        content: item.content,
        language: item.language,
        score,
        raw_data: JSON.stringify(item.raw_data),
      })
      if (id) {
        inserted++
      } else {
        skipped++
        console.log(`  skipped (same url): ${item.title}`)
      }
    }
  }

  return { total, inserted, skipped }
}

// CLI entry point
if (process.argv[1]?.endsWith('run.ts') || process.argv[1]?.endsWith('run.js')) {
  await import('dotenv/config')
  const { createPrisma } = await import('../db/database.js')
  const prisma = createPrisma()

  const mode = process.argv[2]

  if (mode === 'x') {
    const { collectX } = await import('./x.js')
    console.log('Running X collector...')
    const result = await collectX(prisma)
    console.log(`Done. Total ${result.total}, inserted ${result.inserted}, filtered ${result.filtered}, pending_review ${result.pendingReview}`)
  } else {
    console.log('Running collectors...')
    const result = await runCollectors(prisma, [collectRss, collectGithub])
    console.log(`Done. Fetched ${result.total} items, inserted ${result.inserted} new, skipped ${result.skipped} duplicates.`)
  }
  await prisma.$disconnect()
}
