import pLimit from 'p-limit'
import type { PrismaClient } from '../db/database.js'
import type { LLMAdapter } from './llm.js'
import { getRawItemsByStatus } from '../db/database.js'
import { runAgentPipeline } from './pipeline.js'

export async function produceArticles(prisma: PrismaClient, llm: LLMAdapter, limit = 10, concurrency = 1): Promise<{ processed: number; succeeded: number; failed: number; fatalError: boolean }> {
  const items = await getRawItemsByStatus(prisma, 'deduped', limit)
  let succeeded = 0
  let failed = 0
  let fatalError = false

  const limit_ = pLimit(concurrency)
  await Promise.all(items.map(item => limit_(async () => {
    if (fatalError) return
    const result = await runAgentPipeline(prisma, llm, item.id)
    if (result.success) {
      succeeded++
    } else if (result.retryLater) {
      fatalError = true
    } else {
      failed++
    }
  })))

  return { processed: items.length, succeeded, failed, fatalError }
}
