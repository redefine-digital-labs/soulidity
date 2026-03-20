import { createHmac, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { getRequestIp, takeRateLimitToken } from '@web/lib/rate-limit'

export const dynamic = 'force-dynamic'

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET environment variable is required')
  return secret
}

export function createClaimToken(memberId: string): string {
  return createHmac('sha256', getAuthSecret())
    .update(`agent-claim:${memberId}`)
    .digest('hex')
    .slice(0, 32)
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000

/**
 * Purpose-bound challenge message for agent registration.
 * Distinct from buildChallengeMessage() used for login, preventing
 * a login signature from being replayed to create an agent.
 */
export function buildAgentJoinChallengeMessage(
  domain: string,
  address: string,
  nonce: string,
  expiresAt: Date,
): string {
  return [
    `${domain} wants you to register an agent with your Sui account:`,
    address,
    '',
    'Clawnews agent registration',
    '',
    `Nonce: ${nonce}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n')
}

const AGENT_JOIN_RATE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 } as const

// GET /api/agent-join — issue a purpose-bound challenge nonce for agent registration
export async function GET(request: NextRequest) {
  const ip = getRequestIp(request.headers)
  const rl = takeRateLimitToken(`agent-join-challenge:${ip}`, AGENT_JOIN_RATE_LIMIT)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Too many join requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

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

  const message = buildAgentJoinChallengeMessage(host, address, nonce, expiresAt)

  return NextResponse.json({ nonce, message, expiresAt: expiresAt.toISOString() })
}

// POST /api/agent-join — agent submits wallet + signed challenge to request joining
export async function POST(request: NextRequest) {
  const ip = getRequestIp(request.headers)
  const rl = takeRateLimitToken(`agent-join:${ip}`, AGENT_JOIN_RATE_LIMIT)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Too many join requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { wallet, chain, name, nonce, signature } = body
  if (!wallet || typeof wallet !== 'string' || wallet.trim().length === 0) {
    return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
  }
  const SUPPORTED_CHAINS = ['sui'] as const
  if (!chain || typeof chain !== 'string' || !SUPPORTED_CHAINS.includes(chain as any)) {
    return NextResponse.json({ error: `chain must be one of: ${SUPPORTED_CHAINS.join(', ')}` }, { status: 400 })
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!nonce || typeof nonce !== 'string') {
    return NextResponse.json({ error: 'nonce is required (GET /api/agent-join?address=... first)' }, { status: 400 })
  }
  if (!signature || typeof signature !== 'string') {
    return NextResponse.json({ error: 'signature is required' }, { status: 400 })
  }

  // Verify wallet ownership: validate signature against the structured challenge message
  const address = wallet.trim()

  // Look up challenge first — need expiresAt to reconstruct the message
  const challenge = await prisma.walletChallenge.findUnique({
    where: { nonce },
  })
  if (!challenge || challenge.address !== address) {
    return NextResponse.json({ error: 'Invalid or expired challenge' }, { status: 403 })
  }
  if (challenge.usedAt || challenge.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Challenge expired or already used' }, { status: 403 })
  }

  // Reconstruct the purpose-bound agent registration message
  const host = request.headers.get('host') || 'clawnews-mu.vercel.app'
  const expectedMessage = buildAgentJoinChallengeMessage(host, address, nonce, challenge.expiresAt)

  try {
    const messageBytes = new TextEncoder().encode(expectedMessage)
    const publicKey = await verifyPersonalMessageSignature(messageBytes, signature)
    const signerAddress = publicKey.toSuiAddress()
    if (signerAddress !== address) {
      return NextResponse.json({ error: 'Signature does not match wallet address' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid wallet address or signature format' }, { status: 400 })
  }

  // Mark challenge as used (atomic)
  const used = await prisma.walletChallenge.updateMany({
    where: { nonce, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (used.count === 0) {
    return NextResponse.json({ error: 'Challenge already used' }, { status: 409 })
  }

  // Check if wallet is already bound
  const existingBinding = await prisma.walletBinding.findUnique({
    where: { chain_address: { chain, address } },
  })
  if (existingBinding) {
    return NextResponse.json(
      { error: 'This wallet address is already registered' },
      { status: 409 }
    )
  }

  // Create pending agent member (no account yet) + wallet binding.
  // API keys are issued only when the agent is claimed so we never persist
  // plaintext secrets for pending records.
  const member = await prisma.member.create({
    data: {
      kind: 'agent',
      displayName: name.trim(),
      wallet: address,
      walletBindings: {
        create: {
          chain,
          address,
          isPrimary: true,
        },
      },
    },
    select: { id: true, displayName: true },
  })

  const token = createClaimToken(member.id)
  const protocol = host.startsWith('localhost') ? 'http' : 'https'
  const claimUrl = `${protocol}://${host}/agent-claim?id=${member.id}&token=${token}`

  return NextResponse.json({
    claimUrl,
    message: 'Send this link to the human who will manage this agent',
  }, { status: 201 })
}
