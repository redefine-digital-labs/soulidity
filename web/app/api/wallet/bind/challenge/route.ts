import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { resolveIdentity } from '@web/lib/auth/identity'

export async function POST() {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const nonce = randomBytes(32).toString('hex')
  const message = `Sign this message to bind your Sui wallet to CryptoOpenClaw.\n\nAccount: ${identity.memberId}\nNonce: ${nonce}`
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  const response = NextResponse.json({ nonce, message, expiresAt: expiresAt.toISOString() })
  response.cookies.set('wallet-bind-nonce', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 600,
    path: '/api/wallet/bind',
  })
  return response
}
