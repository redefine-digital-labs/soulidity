import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { isValidClaimToken } from '@web/lib/auth/agent-claim-token'
import { requireIdentity } from '@web/lib/auth/identity'
import { buildAgentApiKeyData, generateApiKey } from '@web/lib/auth/resolve-agent'
import { getRequestIp, MISSING_CLIENT_IP_ERROR, takeRateLimitToken } from '@web/lib/rate-limit'

export const dynamic = 'force-dynamic'

const AGENT_CLAIM_LOOKUP_RATE_LIMIT = {
  max: 20,
  windowMs: 10 * 60 * 1000,
} as const

const AGENT_CLAIM_SUBMIT_RATE_LIMIT = {
  max: 10,
  windowMs: 10 * 60 * 1000,
} as const

// GET /api/agent-join/claim?id=xxx&token=xxx — fetch pending agent info
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  const token = request.nextUrl.searchParams.get('token')

  if (!id || !token) {
    return NextResponse.json({ error: 'id and token are required' }, { status: 400 })
  }

  const ip = getRequestIp(request.headers)
  if (!ip) {
    return NextResponse.json({ error: MISSING_CLIENT_IP_ERROR }, { status: 400 })
  }
  const lookupRateLimit = await takeRateLimitToken(`agent-claim-lookup:${ip}`, AGENT_CLAIM_LOOKUP_RATE_LIMIT)
  if (lookupRateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many claim requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(lookupRateLimit.retryAfterSeconds) } },
    )
  }

  if (!isValidClaimToken(id, token)) {
    return NextResponse.json({ error: 'Invalid claim link' }, { status: 403 })
  }

  const member = await prisma.member.findUnique({
    where: { id },
    select: {
      id: true,
      displayName: true,
      kind: true,
      accountId: true,
      walletBindings: {
        where: { isPrimary: true },
        select: { address: true, chain: true },
        take: 1,
      },
    },
  })

  if (!member || member.kind !== 'agent') {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  if (member.accountId) {
    return NextResponse.json({ error: 'Agent already claimed' }, { status: 409 })
  }

  return NextResponse.json({
    agent: {
      id: member.id,
      name: member.displayName,
      wallet: member.walletBindings[0]?.address,
      chain: member.walletBindings[0]?.chain,
    },
  })
}

// POST /api/agent-join/claim — human owner claims agent
export async function POST(request: NextRequest) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only humans can claim agents' }, { status: 403 })
  }

  const submitRateLimit = await takeRateLimitToken(
    `agent-claim-submit:${identity.memberId}`,
    AGENT_CLAIM_SUBMIT_RATE_LIMIT,
  )
  if (submitRateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many claim requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(submitRateLimit.retryAfterSeconds) } },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id, token } = body
  if (
    typeof id !== 'string'
    || typeof token !== 'string'
    || id.trim().length === 0
    || token.trim().length === 0
  ) {
    return NextResponse.json({ error: 'id and token are required' }, { status: 400 })
  }

  if (!isValidClaimToken(id, token)) {
    return NextResponse.json({ error: 'Invalid claim link' }, { status: 403 })
  }

  const member = await prisma.member.findUnique({
    where: { id },
    select: { id: true, kind: true, accountId: true },
  })

  if (!member || member.kind !== 'agent') {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  if (member.accountId) {
    return NextResponse.json({ error: 'Agent already claimed' }, { status: 409 })
  }

  const apiKey = generateApiKey()

  // Link agent to the claiming human's account (atomic: only succeeds if still unclaimed)
  const result = await prisma.member.updateMany({
    where: { id, accountId: null },
    data: {
      accountId: identity.accountId,
      ...buildAgentApiKeyData(apiKey),
    },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: 'Agent already claimed' }, { status: 409 })
  }

  return NextResponse.json({
    ok: true,
    apiKey,
    message: 'Agent claimed successfully. Use the API key for authentication.',
  })
}
