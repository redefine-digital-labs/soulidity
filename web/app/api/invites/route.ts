import { NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'
import { v4 as uuid } from 'uuid'

export async function GET() {
  const db = getDb()
  const invites = db.prepare('SELECT * FROM invite_codes ORDER BY created_at DESC').all()
  return NextResponse.json(invites)
}

export async function POST() {
  const db = getDb()
  const code = uuid().slice(0, 8).toUpperCase()
  db.prepare('INSERT INTO invite_codes (code) VALUES (?)').run(code)
  return NextResponse.json({ code })
}
