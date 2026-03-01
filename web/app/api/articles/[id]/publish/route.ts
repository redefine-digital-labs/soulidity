import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'
import { Bot } from 'grammy'
import { formatArticle } from '@web/lib/formatter'
import { v4 as uuid } from 'uuid'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Record<string, string> | undefined
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const raw = db.prepare('SELECT url FROM raw_items WHERE id = ?').get(article.raw_item_id) as { url: string } | undefined

  const token = process.env.TG_BOT_TOKEN
  const channelId = process.env.TG_CHANNEL_ID

  if (!token || !channelId) {
    return NextResponse.json(
      { error: 'TG_BOT_TOKEN or TG_CHANNEL_ID not configured' },
      { status: 500 }
    )
  }

  const text = formatArticle({
    title_zh: article.title_zh,
    title_en: article.title_en,
    summary_zh: article.summary_zh,
    summary_en: article.summary_en,
    analysis_zh: article.analysis_zh ?? null,
    tags: article.tags ?? null,
    source_url: raw?.url ?? '',
  })

  let messageId: string
  try {
    const bot = new Bot(token)
    const sent = await bot.api.sendMessage(channelId, text)
    messageId = String(sent.message_id)
  } catch (err) {
    return NextResponse.json(
      { error: `TG send failed: ${err instanceof Error ? err.message : err}` },
      { status: 502 }
    )
  }

  db.prepare("UPDATE articles SET status = 'published' WHERE id = ?").run(id)
  const pubId = uuid()
  db.prepare("INSERT INTO publications (id, article_id, channel, message_id, published_at) VALUES (?, ?, 'tg_daily', ?, datetime('now'))").run(pubId, id, messageId)

  return NextResponse.json({ success: true, publication_id: pubId, message_id: messageId })
}
