import 'dotenv/config'
import { createPrisma } from '../db/database.js'
import { autoPublish } from './publish.js'
import { shutdownPostHogWithTimeout } from '../observability/posthog.js'
import { logger } from '../shared/logger.js'

const log = logger.child('publisher:run')
const prisma = createPrisma()
try {
  log.info('Running auto-publish...')
  const result = await autoPublish(prisma)
  log.info(`Done. Published: ${result.published}, Failed: ${result.failed}`)
} finally {
  try {
    await prisma.$disconnect()
  } finally {
    try {
      await shutdownPostHogWithTimeout()
    } catch (error) {
      log.error('[publisher] failed to flush PostHog telemetry:', error)
    }
  }
}
