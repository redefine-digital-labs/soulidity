import cron from 'node-cron'
import type { PrismaClient } from './db/database.js'
import { runCollectors } from './collector/run.js'
import { collectRss } from './collector/rss.js'
import { collectGithub } from './collector/github.js'
import { runDedup } from './producer/dedup.js'
import { produceArticles } from './producer/produce.js'
import type { LLMAdapter } from './producer/llm.js'

export function startScheduler(prisma: PrismaClient, llm: LLMAdapter) {
  let producing = false

  cron.schedule('0 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running RSS collection...`)
    const result = await runCollectors(prisma, [collectRss])
    console.log(`RSS: fetched ${result.total}, inserted ${result.inserted}`)
  })

  cron.schedule('0 6 * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running GitHub collection...`)
    const result = await runCollectors(prisma, [collectGithub])
    console.log(`GitHub: fetched ${result.total}, inserted ${result.inserted}`)
  })

  cron.schedule('25 * * * *', async () => {
    if (producing) {
      console.log(`[${new Date().toISOString()}] Skipping — previous produce still running`)
      return
    }
    producing = true
    try {
      // Step 1: Dedup
      console.log(`[${new Date().toISOString()}] Running deduplication...`)
      const dedupResult = await runDedup(prisma)
      console.log(`Dedup: total ${dedupResult.total}, kept ${dedupResult.kept}, duplicates ${dedupResult.duplicates}`)

      // Step 2: Produce all deduped items continuously
      console.log(`[${new Date().toISOString()}] Running content production...`)
      let totalSucceeded = 0, totalFailed = 0
      while (true) {
        const result = await produceArticles(prisma, llm)
        if (result.processed === 0) break
        totalSucceeded += result.succeeded
        totalFailed += result.failed
        if (result.fatalError) break
      }
      console.log(`Producer done: succeeded ${totalSucceeded}, failed ${totalFailed}`)
    } finally {
      producing = false
    }
  })

  console.log('Scheduler started. Cron jobs:')
  console.log('  RSS collection:      every hour at :00')
  console.log('  GitHub collection:   daily at 06:00')
  console.log('  Dedup + Produce:     every hour at :25')
}
