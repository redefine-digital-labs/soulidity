import '../../scripts/lib/dotenv.js'
import { createPrisma } from '../db/database.js'
import { createLLMAdapter, resolveLLMRuntimeConfig } from './llm.js'
import { produceArticles } from './produce.js'
import { autoPublish } from '../publisher/publish.js'
import { shutdownPostHogWithTimeout } from '../observability/posthog.js'
import { logger } from '../shared/logger.js'

const log = logger.child('producer')

const llmRuntime = resolveLLMRuntimeConfig(process.env)
if (!llmRuntime) {
  log.error('DEEPSEEK_API_KEY is required to run the producer.')
  process.exit(1)
}

const prisma = createPrisma()
const llm = createLLMAdapter(llmRuntime)

try {
  log.info('Producing articles...')
  const result = await produceArticles(prisma, llm, 10, 3)
  log.info(`Done. Processed ${result.processed}, succeeded ${result.succeeded}, failed ${result.failed}.`)

  log.info('Auto-publishing drafts older than 10 minutes...')
  const pubResult = await autoPublish(prisma)
  log.info(`Auto-publish: published ${pubResult.published}, failed ${pubResult.failed}`)
} finally {
  try {
    await prisma.$disconnect()
  } finally {
    try {
      await shutdownPostHogWithTimeout()
    } catch (error) {
      log.error('[producer] failed to flush PostHog telemetry:', error)
    }
  }
}
