import cron from 'node-cron'
import type { Bot } from 'grammy'
import type { PrismaClient } from './db/database.js'
import { expireOldRawItems } from './db/database.js'
import { runCollectors } from './collector/run.js'
import { collectGithub } from './collector/github.js'
import { collectX } from './collector/x.js'
import { runDedup } from './producer/dedup.js'
import { produceArticles } from './producer/produce.js'
import { autoPublish } from './publisher/publish.js'
import type { LLMAdapter } from './producer/llm.js'
import { scanSkills } from './collector/scan-skills.js'
import { captureBackendEvent, captureBackendException } from './observability/posthog.js'
import { logger } from './shared/logger.js'

const log = logger.child('scheduler')

async function runCronJob(
  jobName: string,
  fn: () => Promise<Record<string, unknown> | void>,
): Promise<void> {
  const startedAt = Date.now()
  captureBackendEvent('cron_run_started', { cronJob: jobName })
  try {
    const result = (await fn()) ?? {}
    captureBackendEvent('cron_run_completed', {
      cronJob: jobName,
      elapsedMs: Date.now() - startedAt,
      ...result,
    })
  } catch (err) {
    captureBackendException(err, {
      cronJob: jobName,
      elapsedMs: Date.now() - startedAt,
      scope: 'cron',
    })
    captureBackendEvent('cron_run_failed', {
      cronJob: jobName,
      elapsedMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    })
    log.error(`[${jobName}] failed:`, err)
  }
}

export function startScheduler(prisma: PrismaClient, llm: LLMAdapter | undefined, bot?: Bot) {
  let producing = false

  cron.schedule('0 6 * * *', () =>
    runCronJob('github_collection', async () => {
      log.info(`[${new Date().toISOString()}] Running GitHub collection...`)
      const result = await runCollectors(prisma, [collectGithub])
      log.info(`GitHub: fetched ${result.total}, inserted ${result.inserted}, filtered ${result.filtered}`)
      return { total: result.total, inserted: result.inserted, filtered: result.filtered }
    }),
  )

  cron.schedule('*/30 * * * *', () =>
    runCronJob('x_collection', async () => {
      log.info(`[${new Date().toISOString()}] Running X collection...`)
      const result = await collectX(prisma)
      log.info(`X: total ${result.total}, inserted ${result.inserted}, filtered ${result.filtered}, pending_review ${result.pendingReview}`)
      return {
        total: result.total,
        inserted: result.inserted,
        filtered: result.filtered,
        pendingReview: result.pendingReview,
      }
    }),
  )

  cron.schedule('25 * * * *', () =>
    runCronJob('dedup_and_produce', async () => {
      if (producing) {
        log.info(`[${new Date().toISOString()}] Skipping — previous produce still running`)
        return { skipped: true }
      }
      producing = true
      try {
        // Step 0: Expire old items (>24h) still in new/deduped
        const expired = await expireOldRawItems(prisma)
        if (expired > 0) log.info(`Expired ${expired} old raw items`)

        // Step 1: Dedup
        const dedupResult = await runDedup(prisma)
        if (dedupResult.total > 0) {
          log.info(`Dedup: total ${dedupResult.total}, kept ${dedupResult.kept}, duplicates ${dedupResult.duplicates}`)
        }

        // Step 2: Produce all deduped items continuously
        let totalSucceeded = 0, totalFailed = 0
        if (llm) {
          log.info(`[${new Date().toISOString()}] Running content production...`)
          while (true) {
            const result = await produceArticles(prisma, llm)
            if (result.processed === 0) break
            totalSucceeded += result.succeeded
            totalFailed += result.failed
            if (result.fatalError) break
          }
          log.info(`Producer done: succeeded ${totalSucceeded}, failed ${totalFailed}`)
        } else {
          log.info('LLM not configured — skipping content production.')
        }

        // Step 3: Auto-publish drafts older than 10 minutes
        const pubResult = await autoPublish(prisma, { bot })
        if (pubResult.published > 0 || pubResult.failed > 0) {
          log.info(`Auto-publish: published ${pubResult.published}, failed ${pubResult.failed}`)
        }
        return {
          expired,
          dedupKept: dedupResult.kept,
          dedupDuplicates: dedupResult.duplicates,
          producedSucceeded: totalSucceeded,
          producedFailed: totalFailed,
          published: pubResult.published,
          publishFailed: pubResult.failed,
        }
      } finally {
        producing = false
      }
    }),
  )

  // Auto-publish: drafts older than 10 minutes → publish to TG
  cron.schedule('*/5 * * * *', () =>
    runCronJob('auto_publish', async () => {
      log.info(`[${new Date().toISOString()}] Running auto-publish...`)
      const result = await autoPublish(prisma, { bot })
      if (result.published > 0 || result.failed > 0) {
        log.info(`Auto-publish: published ${result.published}, failed ${result.failed}`)
      }
      return { published: result.published, failed: result.failed }
    }),
  )

  cron.schedule('0 0 * * *', () =>
    runCronJob('skills_scan', async () => {
      log.info(`[${new Date().toISOString()}] Running skills scan...`)
      await scanSkills(prisma)
    }),
  )

  log.info('Scheduler started. Cron jobs:')
  log.info('  GitHub collection:   daily at 06:00')
  log.info('  X collection:        every 30 minutes')
  log.info('  Dedup + Produce:     every hour at :25')
  log.info('  Auto-publish:        every 5 minutes')
  log.info('  Skills scan:         daily at 00:00')
}
