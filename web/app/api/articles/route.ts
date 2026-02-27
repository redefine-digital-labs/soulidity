import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'

export async function GET(request: NextRequest) {
  const db = getDb()
  const status = request.nextUrl.searchParams.get('status')
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '50')

  let articles
  if (status) {
    articles = db.prepare('SELECT * FROM articles WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
  } else {
    articles = db.prepare('SELECT * FROM articles ORDER BY created_at DESC LIMIT ?').all(limit)
  }

  return NextResponse.json(articles)
}
