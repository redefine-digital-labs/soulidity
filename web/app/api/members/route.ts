import { NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'

export async function GET() {
  const db = getDb()
  const members = db.prepare('SELECT * FROM members ORDER BY joined_at DESC').all()
  return NextResponse.json(members)
}
