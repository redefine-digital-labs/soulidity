import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { resolveIdentity } from '@web/lib/auth/identity'
import { takeRateLimitToken } from '@web/lib/rate-limit'

export function buildWalletBindMessage(memberId: string, nonce: string): string {
  return `Sign this message to bind your Sui wallet to CryptoOpenClaw.\n\nAccount: ${memberId}\nNonce: ${nonce}`
}

export async function POST(request: Request) {
  const identity = await resolveIdentity({ allowCookieFallback: false })
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const rateLimit = await takeRateLimitToken(`wallet-bind-challenge:${identity.memberId}`, {
    max: 5,
    windowMs: 60 * 60 * 1000,
  })
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      },
    )
  }

  const nonce = randomBytes(32).toString('hex')
  const message = buildWalletBindMessage(identity.memberId, nonce)
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
