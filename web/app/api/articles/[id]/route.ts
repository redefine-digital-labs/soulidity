import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id)
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const raw = db.prepare('SELECT url, source_name FROM raw_items WHERE id = ?').get((article as { raw_item_id: string }).raw_item_id)
  return NextResponse.json({ ...article as object, source_url: (raw as { url: string })?.url, source_name: (raw as { source_name: string })?.source_name })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const body = await request.json()

  const allowed = ['title_zh', 'title_en', 'summary_zh', 'summary_en', 'analysis_zh', 'analysis_en', 'tags', 'status']
  const sets: string[] = []
  const values: unknown[] = []

  for (const [key, value] of Object.entries(body)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`)
      values.push(value)
    }
  }

  if (sets.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  values.push(id)
  db.prepare(`UPDATE articles SET ${sets.join(', ')} WHERE id = ?`).run(...values)

  const updated = db.prepare('SELECT * FROM articles WHERE id = ?').get(id)
  return NextResponse.json(updated)
}
