import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@web/lib/db'
import { v4 as uuid } from 'uuid'

export async function POST(request: NextRequest) {
  const db = getDb()
  const { code, tg_id, tg_name } = await request.json()

  if (!code || !tg_id) {
    return NextResponse.json({ error: 'code and tg_id required' }, { status: 400 })
  }

  const invite = db.prepare('SELECT * FROM invite_codes WHERE code = ? AND active = 1 AND used_by IS NULL').get(code)
  if (!invite) {
    return NextResponse.json({ verified: false, error: 'Invalid or used invite code' })
  }

  db.prepare('UPDATE invite_codes SET used_by = ?, active = 0 WHERE code = ?').run(tg_id, code)
  db.prepare('INSERT OR IGNORE INTO members (id, tg_id, tg_name, invite_code) VALUES (?, ?, ?, ?)').run(uuid(), tg_id, tg_name ?? null, code)

  return NextResponse.json({ verified: true })
}
