import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_NAME, COOKIE_MAX_AGE, hmacSign } from '@web/lib/auth'

export async function POST(request: NextRequest) {
  const { password } = await request.json()
  const adminPassword = process.env.ADMIN_PASSWORD
  const secret = process.env.AUTH_SECRET

  if (!adminPassword || !secret) {
    return NextResponse.json({ error: 'Auth not configured' }, { status: 500 })
  }

  if (password !== adminPassword) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  const token = await hmacSign(adminPassword, secret)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
  return response
}
