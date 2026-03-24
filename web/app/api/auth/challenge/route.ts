import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

import { prisma } from '@web/lib/prisma'
import { getRequestIp, MISSING_CLIENT_IP_ERROR, takeRateLimitToken } from '@web/lib/rate-limit'
import {
  buildChallengeMessage,
  cleanupStaleWalletChallengesBestEffort,
  getWalletChallengeCleanupCutoff,
  getTrustedAppDomain,
  normalizeSuiWalletAddress,
} from '@web/lib/auth/challenge'

export const dynamic = 'force-dynamic'

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const AUTH_CHALLENGE_RATE_LIMIT = {
  max: 10,
  windowMs: 60 * 1000,
} as const

// GET /api/auth/challenge?address=<wallet> — issue a one-time nonce
export async function GET(request: NextRequest) {
  const ip = getRequestIp(request.headers)
  if (!ip) {
    return NextResponse.json({ error: MISSING_CLIENT_IP_ERROR }, { status: 400 })
  }

  const rateLimit = takeRateLimitToken(`auth-challenge:${ip}`, AUTH_CHALLENGE_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many challenge requests, try again later' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      },
    )
  }

  const address = normalizeSuiWalletAddress(request.nextUrl.searchParams.get('address'))
  if (!address) {
    return NextResponse.json({ error: 'address must be a valid Sui address' }, { status: 400 })
  }

  const nonce = randomUUID()
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS)
  const domain = getTrustedAppDomain()

  cleanupStaleWalletChallengesBestEffort(() =>
    prisma.walletChallenge.deleteMany({
      where: {
        expiresAt: { lt: getWalletChallengeCleanupCutoff() },
      },
    }),
  )

  await prisma.walletChallenge.create({
    data: { address, nonce, expiresAt, domain },
  })

  const message = buildChallengeMessage(domain, address, nonce, expiresAt)

  return NextResponse.json({ nonce, message, expiresAt: expiresAt.toISOString() })
}
