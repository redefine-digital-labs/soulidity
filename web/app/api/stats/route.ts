import { NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'

export async function GET() {
  const db = getDb()
  const raw_new = (db.prepare("SELECT COUNT(*) as c FROM raw_items WHERE status = 'new'").get() as { c: number }).c
  const articles_draft = (db.prepare("SELECT COUNT(*) as c FROM articles WHERE status = 'draft'").get() as { c: number }).c
  const articles_reviewed = (db.prepare("SELECT COUNT(*) as c FROM articles WHERE status = 'reviewed'").get() as { c: number }).c
  const published_today = (db.prepare("SELECT COUNT(*) as c FROM publications WHERE published_at >= date('now')").get() as { c: number }).c

  return NextResponse.json({ raw_new, articles_draft, articles_reviewed, published_today })
}
