import { Bot, InlineKeyboard } from 'grammy'
import type { PrismaClient } from '../db/database.js'
import { formatArticle } from './formatter.js'
import { syncArticleToPost } from '../shared/sync-article-post.js'
import { captureBackendEvent, captureBackendException } from '../observability/posthog.js'

/** Auto-publish draft articles older than `maxAgeMs` (default 10 minutes). */
export async function autoPublish(
  prisma: PrismaClient,
  opts: { maxAgeMs?: number; bot?: Bot } = {}
): Promise<{ published: number; failed: number }> {
  const maxAge = opts.maxAgeMs ?? 10 * 60 * 1000
  const cutoff = new Date(Date.now() - maxAge)

  const token = process.env.TG_BOT_TOKEN
  const channelId = process.env.TG_CHANNEL_ID
  if (!channelId || (!token && !opts.bot)) {
    console.error('TG_BOT_TOKEN or TG_CHANNEL_ID not configured, skipping auto-publish')
    return { published: 0, failed: 0 }
  }

  const articles = await prisma.article.findMany({
    where: { status: 'draft', createdAt: { lte: cutoff } },
    include: {
      rawItem: { select: { url: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (articles.length === 0) return { published: 0, failed: 0 }

  const bot = opts.bot ?? new Bot(token!)
  let published = 0
  let failed = 0

  for (const article of articles) {
    try {
      const text = formatArticle({
        title_zh: article.titleZh,
        summary_zh: article.summaryZh,
        analysis_zh: article.analysisZh ?? null,
        source_url: article.rawItem?.url ?? '',
      })

      const botUsername = process.env.TG_BOT_USERNAME
      const sendOpts: any = { parse_mode: 'HTML' }
      if (botUsername) {
        const keyboard = new InlineKeyboard()
          .url('🦞 加入社群', `https://t.me/${botUsername}?start=join`)
        sendOpts.reply_markup = keyboard
      }

      const sent = await bot.api.sendMessage(channelId, text, sendOpts)
      const messageId = String(sent.message_id)

      await prisma.article.update({ where: { id: article.id }, data: { status: 'published' } })
      await prisma.publication.create({
        data: { articleId: article.id, channel: 'tg_daily', messageId, publishedAt: new Date() },
      })

      captureBackendEvent('article_published', { articleId: article.id, messageId, channel: 'tg_daily' })

      // Sync to community news post (awaited to avoid orphaned promises before disconnect)
      try {
        await syncArticleToPost(prisma, article.id)
      } catch (err) {
        console.error(`Failed to sync article ${article.id} to community post:`, err)
      }

      published++
    } catch (err) {
      console.error(`Failed to auto-publish article ${article.id}:`, err instanceof Error ? err.message : err)
      captureBackendException(err, { scope: 'publisher', articleId: article.id })
      captureBackendEvent('article_publish_failed', { articleId: article.id, error: err instanceof Error ? err.message : String(err) })
      failed++
    }
  }

  // Catch-up: retry sync for any published articles that are missing a community post.
  // This handles transient failures from previous runs where the article was published
  // to Telegram but syncArticleToPost failed.
  try {
    const unsyncedArticles = await prisma.article.findMany({
      where: { status: 'published', posts: { none: {} } },
      select: { id: true },
      take: 20,
    })
    for (const art of unsyncedArticles) {
      try {
        await syncArticleToPost(prisma, art.id)
      } catch (err) {
        console.error(`Catch-up sync failed for article ${art.id}:`, err)
      }
    }
  } catch (err) {
    console.error('Catch-up sync query failed:', err)
  }

  return { published, failed }
}
