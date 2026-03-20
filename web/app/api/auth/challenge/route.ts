import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const CHALLENGE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Build a SIWS-style structured challenge message.
 * Both challenge creation and verification reconstruct this independently,
 * so a signature made for domain A cannot pass verification on domain B.
 */
export function buildChallengeMessage(
  domain: string,
  address: string,
  nonce: string,
  expiresAt: Date
): string {
  return [
    `${domain} wants you to sign in with your Sui account:`,
    address,
    '',
    'Clawnews authentication',
    '',
    `Nonce: ${nonce}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n')
}

// GET /api/auth/challenge?address=<wallet> — issue a one-time nonce
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address')
  if (!address) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 })
  }

  const nonce = randomUUID()
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS)
  const host = request.headers.get('host') || 'clawnews-mu.vercel.app'

  await prisma.walletChallenge.create({
    data: { address, nonce, expiresAt },
  })

  const message = buildChallengeMessage(host, address, nonce, expiresAt)

  return NextResponse.json({ nonce, message, expiresAt: expiresAt.toISOString() })
}
