import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'
import { v4 as uuid } from 'uuid'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()

  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id)
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  db.prepare("UPDATE articles SET status = 'published' WHERE id = ?").run(id)

  const pubId = uuid()
  db.prepare("INSERT INTO publications (id, article_id, channel, message_id, published_at) VALUES (?, ?, 'tg_daily', NULL, datetime('now'))").run(pubId, id)

  return NextResponse.json({ success: true, publication_id: pubId })
}
