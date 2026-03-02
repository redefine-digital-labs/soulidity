import type Database from 'better-sqlite3'
import { collectRss } from './rss.js'
import { collectGithub } from './github.js'
import { scoreItem } from './score.js'
import { isDuplicate } from './dedup.js'
import { insertRawItem } from '../db/database.js'
import type { CollectedItem } from './types.js'

export async function runCollectors(db: Database.Database, collectors: Array<() => Promise<CollectedItem[]>>): Promise<{ total: number; inserted: number; skipped: number }> {
  let total = 0
  let inserted = 0
  let skipped = 0

  for (const collector of collectors) {
    const items = await collector()
    total += items.length

    for (const item of items) {
      const dedup = isDuplicate(db, item.title)
      if (dedup.duplicate) {
        console.log(`  skipped (similar to ${dedup.matchedId}): ${item.title}`)
        skipped++
        continue
      }

      const score = scoreItem(item.title, item.content)
      const id = insertRawItem(db, {
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
      if (id) inserted++
    }
  }

  return { total, inserted, skipped }
}

// CLI entry point
if (process.argv[1]?.endsWith('run.ts') || process.argv[1]?.endsWith('run.js')) {
  const { createDb } = await import('../db/database.js')
  const path = await import('path')
  const db = createDb(path.join(process.cwd(), 'data', 'clawnews.db'))

  console.log('Running collectors...')
  const result = await runCollectors(db, [collectRss, collectGithub])
  console.log(`Done. Fetched ${result.total} items, inserted ${result.inserted} new, skipped ${result.skipped} duplicates.`)
  db.close()
}
