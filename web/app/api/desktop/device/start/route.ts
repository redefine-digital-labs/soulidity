import { NextRequest, NextResponse } from 'next/server'

import { startDesktopDeviceSession } from '@/lib/desktop/device-session'
import { takeRateLimitToken, getRequestIp, getAnonymousRateLimitFingerprint } from '@/lib/rate-limit'
import { normalizeSuiWalletAddress } from '@/lib/auth/challenge'
import { consumeWalletChallengeForPurpose } from '@/lib/auth/wallet-challenge'

export const dynamic = 'force-dynamic'

const IP_RATE_LIMIT = { max: 5, windowMs: 60_000 }
const ADDRESS_RATE_LIMIT = { max: 5, windowMs: 60_000 }

export async function POST(request: NextRequest) {
  const ip = getRequestIp(request.headers)
    ?? getAnonymousRateLimitFingerprint(request.headers)
    ?? 'anonymous'
  const ipBucket = await takeRateLimitToken(`device-start:${ip}`, IP_RATE_LIMIT)
  if (ipBucket.limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(ipBucket.retryAfterSeconds) } },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'agentAddress, nonce, and signature are required' }, { status: 400 })
  }

  const record = body as Record<string, unknown>
  const rawAddress = typeof record.agentAddress === 'string' ? record.agentAddress.trim() : ''
  const nonce = typeof record.nonce === 'string' ? record.nonce.trim() : ''
  const signature = typeof record.signature === 'string' ? record.signature : ''
  if (!rawAddress || !nonce || !signature) {
    return NextResponse.json({ error: 'agentAddress, nonce, and signature are required' }, { status: 400 })
  }

  const normalized = normalizeSuiWalletAddress(rawAddress)
  if (!normalized) {
    return NextResponse.json({ error: 'Invalid agent address' }, { status: 400 })
  }

  const addressBucket = await takeRateLimitToken(
    `device-start:${ip}:${normalized}`,
    ADDRESS_RATE_LIMIT,
  )
  if (addressBucket.limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(addressBucket.retryAfterSeconds) } },
    )
  }

  const consumeResult = await consumeWalletChallengeForPurpose({
    nonce,
    address: normalized,
    purpose: 'desktop-link',
    signature,
  })
  if (!consumeResult.ok) {
    return NextResponse.json({ error: 'Invalid desktop link signature' }, { status: 401 })
  }

  const session = await startDesktopDeviceSession({ agentAddress: normalized })
  return NextResponse.json(session)
}
