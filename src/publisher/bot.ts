import { Bot } from 'grammy'
import type Database from 'better-sqlite3'
import { formatArticle } from './formatter.js'
import type { Article } from '../shared/types.js'
import { v4 as uuid } from 'uuid'

export function createBot(token: string) {
  return new Bot(token)
}

export async function publishToChannel(
  bot: Bot,
  channelId: string,
  db: Database.Database,
  articleId: string,
): Promise<string> {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId) as Article | undefined
  if (!article) throw new Error(`Article not found: ${articleId}`)

  const raw = db.prepare('SELECT url FROM raw_items WHERE id = ?').get(article.raw_item_id) as { url: string } | undefined

  const text = formatArticle({
    title_zh: article.title_zh,
    title_en: article.title_en,
    summary_zh: article.summary_zh,
    summary_en: article.summary_en,
    analysis_zh: article.analysis_zh,
    tags: article.tags,
    source_url: raw?.url ?? '',
  })

  const sent = await bot.api.sendMessage(channelId, text)
  const messageId = String(sent.message_id)

  // Update article status and record publication
  db.prepare("UPDATE articles SET status = 'published' WHERE id = ?").run(articleId)
  db.prepare(`
    INSERT INTO publications (id, article_id, channel, message_id, published_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(uuid(), articleId, channelId, messageId)

  return messageId
}
