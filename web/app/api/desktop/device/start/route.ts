import { NextRequest, NextResponse } from 'next/server'

import { startDesktopDeviceSession } from '@/lib/desktop/device-session'
import { takeRateLimitToken, getRequestIp, getAnonymousRateLimitFingerprint } from '@web/lib/rate-limit'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_OPTS = { max: 5, windowMs: 60_000 }

export async function POST(request: NextRequest) {
  const ip = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (ip) {
    const { limited, retryAfterSeconds } = await takeRateLimitToken(`device-start:${ip}`, RATE_LIMIT_OPTS)
    if (limited) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
      )
    }
  }
  const session = await startDesktopDeviceSession()
  return NextResponse.json(session)
}
