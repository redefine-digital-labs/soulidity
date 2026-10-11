import { NextResponse, type NextRequest } from 'next/server'

import {
  InvalidWalletAddressError,
  issueWalletChallenge,
} from '@/lib/auth/wallet-challenge'
import {
  getAnonymousRateLimitFingerprint,
  getRequestIp,
  takeRateLimitToken,
} from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const RATE_LIMIT = { max: 30, windowMs: 60 * 1000 }

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const address = body && typeof body === 'object' && 'address' in body && typeof body.address === 'string'
    ? body.address
    : ''
  if (!address) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 })
  }

  const fingerprint = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (fingerprint) {
    const { limited } = await takeRateLimitToken(`wallet-challenge:${fingerprint}`, RATE_LIMIT)
    if (limited) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
  }

  try {
    const challenge = await issueWalletChallenge(address, 'login')
    return NextResponse.json({
      nonce: challenge.nonce,
      message: challenge.message,
      expiresAt: challenge.expiresAt.toISOString(),
      domain: challenge.domain,
      address: challenge.address,
    })
  } catch (error) {
    if (error instanceof InvalidWalletAddressError) {
      return NextResponse.json({ error: 'Invalid Sui wallet address' }, { status: 400 })
    }
    console.error('Failed to issue wallet challenge', { error })
    return NextResponse.json({ error: 'Failed to issue wallet challenge' }, { status: 500 })
  }
}
