import cron from 'node-cron'
import type { PrismaClient } from './db/database.js'
import { runCollectors } from './collector/run.js'
import { collectRss } from './collector/rss.js'
import { collectGithub } from './collector/github.js'
import { produceArticles } from './producer/produce.js'
import type { LLMAdapter } from './producer/llm.js'

export function startScheduler(prisma: PrismaClient, llm: LLMAdapter) {
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

  cron.schedule('30 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running content production...`)
    const result = await produceArticles(prisma, llm)
    console.log(`Producer: processed ${result.processed}, succeeded ${result.succeeded}, failed ${result.failed}`)
  })

  console.log('Scheduler started. Cron jobs:')
  console.log('  RSS collection:      every hour at :00')
  console.log('  GitHub collection:   daily at 06:00')
  console.log('  Content production:  every hour at :30')
}
