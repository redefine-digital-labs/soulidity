import { NextResponse } from 'next/server'

import {
  buildCsrfClearCookie,
  buildSessionClearCookie,
} from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.headers.append('Set-Cookie', buildSessionClearCookie())
  response.headers.append('Set-Cookie', buildCsrfClearCookie())
  return response
}
