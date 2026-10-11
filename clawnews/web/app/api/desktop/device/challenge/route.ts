import { NextResponse, type NextRequest } from 'next/server'

import {
  InvalidWalletAddressError,
  issueWalletChallenge,
} from '@/lib/auth/wallet-challenge'
import { normalizeSuiWalletAddress } from '@/lib/auth/challenge'
import {
  getAnonymousRateLimitFingerprint,
  getRequestIp,
  takeRateLimitToken,
} from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const IP_RATE_LIMIT = { max: 30, windowMs: 60_000 }
const ADDRESS_RATE_LIMIT = { max: 5, windowMs: 60_000 }

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const rawAddress = body && typeof body === 'object' && 'address' in body && typeof body.address === 'string'
    ? body.address
    : ''
  if (!rawAddress) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 })
  }

  const normalizedAddress = normalizeSuiWalletAddress(rawAddress)
  if (!normalizedAddress) {
    return NextResponse.json({ error: 'Invalid Sui wallet address' }, { status: 400 })
  }

  const fingerprint = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers) ?? 'anonymous'

  const ipBucket = await takeRateLimitToken(`device-challenge:${fingerprint}`, IP_RATE_LIMIT)
  if (ipBucket.limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(ipBucket.retryAfterSeconds) } },
    )
  }

  const addressBucket = await takeRateLimitToken(
    `device-challenge:${fingerprint}:${normalizedAddress}`,
    ADDRESS_RATE_LIMIT,
  )
  if (addressBucket.limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(addressBucket.retryAfterSeconds) } },
    )
  }

  try {
    const challenge = await issueWalletChallenge(normalizedAddress, 'desktop-link')
    return NextResponse.json({
      address: challenge.address,
      nonce: challenge.nonce,
      message: challenge.message,
      expiresAt: challenge.expiresAt.toISOString(),
      domain: challenge.domain,
    })
  } catch (error) {
    if (error instanceof InvalidWalletAddressError) {
      return NextResponse.json({ error: 'Invalid Sui wallet address' }, { status: 400 })
    }
    console.error('Failed to issue desktop link challenge', { error })
    return NextResponse.json({ error: 'Failed to issue desktop link challenge' }, { status: 500 })
  }
}
