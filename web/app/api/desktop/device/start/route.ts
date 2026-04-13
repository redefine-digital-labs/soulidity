import { NextRequest, NextResponse } from 'next/server'

import { startDesktopDeviceSession } from '@/lib/desktop/device-session'
import { takeRateLimitToken, getRequestIp, getAnonymousRateLimitFingerprint } from '@web/lib/rate-limit'
import { normalizeSuiWalletAddress } from '@web/lib/auth/challenge'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_OPTS = { max: 5, windowMs: 60_000 }

export async function POST(request: NextRequest) {
  const ip = getRequestIp(request.headers)
    ?? getAnonymousRateLimitFingerprint(request.headers)
    ?? 'anonymous'
  const { limited, retryAfterSeconds } = await takeRateLimitToken(`device-start:${ip}`, RATE_LIMIT_OPTS)
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  }

  let agentAddress: string | undefined
  try {
    const body = await request.json()
    if (body && typeof body === 'object' && typeof body.agentAddress === 'string') {
      const raw = body.agentAddress.trim()
      if (raw) {
        const normalized = normalizeSuiWalletAddress(raw)
        if (!normalized) {
          return NextResponse.json({ error: 'Invalid agent address' }, { status: 400 })
        }
        agentAddress = normalized
      }
    }
  } catch { /* no body is fine */ }

  const session = await startDesktopDeviceSession({ agentAddress })
  return NextResponse.json(session)
}
