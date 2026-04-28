import type { PrismaClient } from '../db/database.js'
import { collectRss } from './rss.js'
import { collectGithub } from './github.js'
import { scoreItem } from './score.js'
import { isDuplicate } from './dedup.js'
import { insertRawItem } from '../db/database.js'
import { isRelevant } from './x.js'
import type { CollectedItem } from './types.js'
import { captureBackendEvent, shutdownPostHogWithTimeout } from '../observability/posthog.js'

export async function runCollectors(prisma: PrismaClient, collectors: Array<() => Promise<CollectedItem[]>>): Promise<{ total: number; inserted: number; skipped: number; filtered: number }> {
  let total = 0
  let inserted = 0
  let skipped = 0
  let filtered = 0

  for (const collector of collectors) {
    const items = await collector()
    total += items.length

    for (const item of items) {
      if (!isRelevant(`${item.title} ${item.content}`)) {
        filtered++
        continue
      }
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

  captureBackendEvent('collector_run_completed', { total, inserted, skipped, filtered })
  return { total, inserted, skipped, filtered }
}

// CLI entry point
if (process.argv[1]?.endsWith('run.ts') || process.argv[1]?.endsWith('run.js')) {
  await import('dotenv/config')
  const { createPrisma } = await import('../db/database.js')
  const prisma = createPrisma()

  const mode = process.argv[2]

  try {
    if (mode === 'x') {
      const { collectX, closePool } = await import('./x.js')
      console.log('Running X collector...')
      try {
        const result = await collectX(prisma)
        console.log(`Done. Total ${result.total}, inserted ${result.inserted}, filtered ${result.filtered}, pending_review ${result.pendingReview}`)
      } finally {
        await closePool()
      }
    } else {
      console.log('Running collectors...')
      const result = await runCollectors(prisma, [collectRss, collectGithub])
      console.log(`Done. Fetched ${result.total} items, inserted ${result.inserted} new, filtered ${result.filtered}, skipped ${result.skipped} duplicates.`)
    }
  } finally {
    try {
      await prisma.$disconnect()
    } finally {
      try {
        await shutdownPostHogWithTimeout()
      } catch (error) {
        console.error('[collector] failed to flush PostHog telemetry:', error)
      }
    }
  }
}
