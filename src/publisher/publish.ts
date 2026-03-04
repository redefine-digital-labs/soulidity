import { Bot } from 'grammy'
import type { PrismaClient } from '../db/database.js'
import { formatArticle } from './formatter.js'

/** Auto-publish draft articles older than `maxAgeMs` (default 10 minutes). */
export async function autoPublish(
  prisma: PrismaClient,
  opts: { maxAgeMs?: number } = {}
): Promise<{ published: number; failed: number }> {
  const maxAge = opts.maxAgeMs ?? 10 * 60 * 1000
  const cutoff = new Date(Date.now() - maxAge)

  const token = process.env.TG_BOT_TOKEN
  const channelId = process.env.TG_CHANNEL_ID
  if (!token || !channelId) {
    console.error('TG_BOT_TOKEN or TG_CHANNEL_ID not configured, skipping auto-publish')
    return { published: 0, failed: 0 }
  }

  const articles = await prisma.article.findMany({
    where: { status: 'draft', createdAt: { lte: cutoff } },
    include: {
      rawItem: { select: { url: true } },
      companies: { include: { company: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (articles.length === 0) return { published: 0, failed: 0 }

  const bot = new Bot(token)
  let published = 0
  let failed = 0

  for (const article of articles) {
    try {
      const text = formatArticle({
        title_zh: article.titleZh,
        summary_zh: article.summaryZh,
        analysis_zh: article.analysisZh ?? null,
        tags: article.tags ?? null,
        companies: article.companies.map(ac => ac.company.name),
        source_url: article.rawItem?.url ?? '',
      })

      const sent = await bot.api.sendMessage(channelId, text)
      const messageId = String(sent.message_id)

      await prisma.article.update({ where: { id: article.id }, data: { status: 'published' } })
      await prisma.publication.create({
        data: { articleId: article.id, channel: 'tg_daily', messageId, publishedAt: new Date() },
      })
      published++
    } catch (err) {
      console.error(`Failed to auto-publish article ${article.id}:`, err instanceof Error ? err.message : err)
      failed++
    }
  }

  return { published, failed }
}
