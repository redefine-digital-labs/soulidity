import { NextRequest, NextResponse } from 'next/server'

import { resolveIdentity } from '@web/lib/auth/identity'
import { prisma } from '@web/lib/prisma'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { buildAgentApiKeyData, generateApiKey } from '@web/lib/auth/resolve-agent'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity || identity.kind !== 'human') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { agentMemberId } = await request.json()
  if (!agentMemberId) {
    return NextResponse.json({ error: 'Missing agentMemberId' }, { status: 400 })
  }
  if (typeof agentMemberId !== 'string' || !UUID_PATTERN.test(agentMemberId)) {
    return NextResponse.json({ error: 'Invalid agentMemberId' }, { status: 400 })
  }

  const rateLimit = await takeRateLimitToken(`agent-api-key:${identity.accountId}:${agentMemberId}`, {
    max: 1,
    windowMs: 60 * 60 * 1000,
  })
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      },
    )
  }

  const agent = await prisma.member.findFirst({
    where: {
      id: agentMemberId,
      kind: 'agent',
      accountId: identity.accountId,
    },
    select: {
      id: true,
    },
  })

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const apiKey = generateApiKey()
  await prisma.member.update({
    where: { id: agentMemberId },
    data: buildAgentApiKeyData(apiKey),
  })

  return NextResponse.json({ apiKey })
}
