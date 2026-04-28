import 'dotenv/config'
import { createPrisma } from '../db/database.js'
import { autoPublish } from './publish.js'
import { shutdownPostHogWithTimeout } from '../observability/posthog.js'

const prisma = createPrisma()
try {
  console.log('Running auto-publish...')
  const result = await autoPublish(prisma)
  console.log(`Done. Published: ${result.published}, Failed: ${result.failed}`)
} finally {
  try {
    await prisma.$disconnect()
  } finally {
    try {
      await shutdownPostHogWithTimeout()
    } catch (error) {
      console.error('[publisher] failed to flush PostHog telemetry:', error)
    }
  }
}
