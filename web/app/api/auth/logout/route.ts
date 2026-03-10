import { NextResponse } from 'next/server'
import { clearSession } from '@web/lib/auth/session'

export async function POST() {
  await clearSession()
  return NextResponse.json({ ok: true })
}
