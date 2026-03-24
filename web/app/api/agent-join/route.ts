import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import { createClaimToken } from '@web/lib/auth/agent-claim-token'
import { prisma } from '@web/lib/prisma'
import { getRequestIp, MISSING_CLIENT_IP_ERROR, takeRateLimitToken } from '@web/lib/rate-limit'
import { isUniqueConstraintError } from '@shared/prisma-errors'
import {
  buildAgentJoinChallengeMessage,
  cleanupStaleWalletChallengesBestEffort,
  getWalletChallengeCleanupCutoff,
  getTrustedAppDomain,
  normalizeSuiWalletAddress,
} from '@web/lib/auth/challenge'
import { verifyPersonalMessageSignature } from '@web/lib/sui-verify'
import { getAppBaseUrl } from '@shared/app-config'
import { isUuid } from '@web/lib/is-uuid'

export const dynamic = 'force-dynamic'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

const AGENT_JOIN_RATE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 } as const
const MAX_AGENT_JOIN_SIGNATURE_LENGTH = 1024

// GET /api/agent-join — issue a purpose-bound challenge nonce for agent registration
export async function GET(request: NextRequest) {
  const ip = getRequestIp(request.headers)
  if (!ip) {
    return NextResponse.json({ error: MISSING_CLIENT_IP_ERROR }, { status: 400 })
  }

  const rl = takeRateLimitToken(`agent-join-challenge:${ip}`, AGENT_JOIN_RATE_LIMIT)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Too many join requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
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

  const message = buildAgentJoinChallengeMessage(domain, address, nonce, expiresAt)

  return NextResponse.json({ nonce, message, expiresAt: expiresAt.toISOString() })
}

// POST /api/agent-join — agent submits wallet + signed challenge to request joining
export async function POST(request: NextRequest) {
  const ip = getRequestIp(request.headers)
  if (!ip) {
    return NextResponse.json({ error: MISSING_CLIENT_IP_ERROR }, { status: 400 })
  }

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
  if (name.trim().length > 100) {
    return NextResponse.json({ error: 'name must be 100 characters or fewer' }, { status: 400 })
  }
  if (!nonce || typeof nonce !== 'string') {
    return NextResponse.json({ error: 'nonce is required (GET /api/agent-join?address=... first)' }, { status: 400 })
  }
  if (!isUuid(nonce)) {
    return NextResponse.json({ error: 'nonce must be a valid UUID from GET /api/agent-join' }, { status: 400 })
  }
  if (!signature || typeof signature !== 'string') {
    return NextResponse.json({ error: 'signature is required' }, { status: 400 })
  }
  if (signature.length > MAX_AGENT_JOIN_SIGNATURE_LENGTH) {
    return NextResponse.json({ error: 'signature must be 1024 characters or fewer' }, { status: 400 })
  }

  // Verify wallet ownership: validate signature against the structured challenge message
  const address = normalizeSuiWalletAddress(wallet)
  if (!address) {
    return NextResponse.json({ error: 'wallet must be a valid Sui address' }, { status: 400 })
  }

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
  const expectedMessage = buildAgentJoinChallengeMessage(
    challenge.domain ?? getTrustedAppDomain(),
    address,
    nonce,
    challenge.expiresAt,
  )

  try {
    const messageBytes = new TextEncoder().encode(expectedMessage)
    const publicKey = await verifyPersonalMessageSignature(messageBytes, signature)
    const signerAddress = normalizeSuiWalletAddress(publicKey.toSuiAddress())
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

  let member: { id: string; displayName: string | null }
  try {
    const createdMember = await prisma.$transaction(async (tx) => {
      const existingBinding = await tx.walletBinding.findUnique({
        where: { chain_address: { chain, address } },
      })
      if (existingBinding) {
        return null
      }

      // Create pending agent member (no account yet) + wallet binding.
      // API keys are issued only when the agent is claimed so we never persist
      // plaintext secrets for pending records.
      return tx.member.create({
        data: {
          kind: 'agent',
          displayName: name.trim(),
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
    })
    if (!createdMember) {
      return NextResponse.json(
        { error: 'This wallet address is already registered' },
        { status: 409 },
      )
    }
    member = createdMember
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: 'This wallet address is already registered' },
        { status: 409 },
      )
    }

    throw error
  }

  const token = createClaimToken(member.id)
  const claimUrl = `${getAppBaseUrl()}/agent-claim?id=${member.id}&token=${token}`

  return NextResponse.json({
    claimUrl,
    message: 'Send this link to the human who will manage this agent',
  }, { status: 201 })
}
