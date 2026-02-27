import cron from 'node-cron'
import type Database from 'better-sqlite3'
import { runCollectors } from './collector/run.js'
import { collectRss } from './collector/rss.js'
import { collectGithub } from './collector/github.js'
import { produceArticles } from './producer/produce.js'
import type { LLMAdapter } from './producer/llm.js'

export function startScheduler(db: Database.Database, llm: LLMAdapter) {
  // RSS collection — every hour
  cron.schedule('0 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running RSS collection...`)
    const result = await runCollectors(db, [collectRss])
    console.log(`RSS: fetched ${result.total}, inserted ${result.inserted}`)
  })

  // GitHub collection — daily at 6:00
  cron.schedule('0 6 * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running GitHub collection...`)
    const result = await runCollectors(db, [collectGithub])
    console.log(`GitHub: fetched ${result.total}, inserted ${result.inserted}`)
  })

  // Content production — every hour at :30 (after collection)
  cron.schedule('30 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running content production...`)
    const result = await produceArticles(db, llm)
    console.log(`Producer: processed ${result.processed}, succeeded ${result.succeeded}, failed ${result.failed}`)
  })

  console.log('Scheduler started. Cron jobs:')
  console.log('  RSS collection:      every hour at :00')
  console.log('  GitHub collection:   daily at 06:00')
  console.log('  Content production:  every hour at :30')
}
