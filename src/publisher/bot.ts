import { Bot } from 'grammy'
import type { PrismaClient } from '../db/database.js'
import { formatArticle } from './formatter.js'

export function createBot(token: string) {
  return new Bot(token)
}

export async function publishToChannel(
  bot: Bot,
  channelId: string,
  prisma: PrismaClient,
  articleId: string,
): Promise<string> {
  const article = await prisma.article.findUnique({ where: { id: articleId } })
  if (!article) throw new Error(`Article not found: ${articleId}`)

  const raw = await prisma.rawItem.findUnique({
    where: { id: article.rawItemId },
    select: { url: true },
  })

  const text = formatArticle({
    title_zh: article.titleZh,
    summary_zh: article.summaryZh,
    analysis_zh: article.analysisZh,
    tags: article.tags,
    source_url: raw?.url ?? '',
  })

  const sent = await bot.api.sendMessage(channelId, text)
  const messageId = String(sent.message_id)

  // Update article status
  await prisma.article.update({ where: { id: articleId }, data: { status: 'published' } })

  // Record publication
  await prisma.publication.create({
    data: { articleId, channel: channelId, messageId, publishedAt: new Date() },
  })

  return messageId
}
