import { NextRequest, NextResponse } from 'next/server'

import { getRequestIp, MISSING_CLIENT_IP_ERROR, takeRateLimitToken } from '@web/lib/rate-limit'

import { resolveAgentByApiKey, type AgentIdentity } from './resolve-agent'

const FAILED_AGENT_AUTH_LIMIT = {
  max: 60,
  windowMs: 60 * 1000,
} as const

function buildFailedAgentAuthResponse(request: NextRequest, error: string) {
  const ip = getRequestIp(request.headers)
  if (!ip) {
    return NextResponse.json({ error: MISSING_CLIENT_IP_ERROR }, { status: 400 })
  }
  const rateLimit = takeRateLimitToken(`agent-auth-failed:${ip}`, FAILED_AGENT_AUTH_LIMIT)

  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many invalid API key attempts' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      },
    )
  }

  return NextResponse.json({ error }, { status: 401 })
}

export async function requireAgentApiKey(
  request: NextRequest,
): Promise<
  | { agent: AgentIdentity; response: null }
  | { agent: null; response: NextResponse }
> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return {
      agent: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  if (!authHeader.startsWith('Bearer sk-')) {
    return {
      agent: null,
      response: buildFailedAgentAuthResponse(request, 'Unauthorized'),
    }
  }

  const agent = await resolveAgentByApiKey(authHeader.slice(7))
  if (!agent) {
    return {
      agent: null,
      response: buildFailedAgentAuthResponse(request, 'Invalid API key'),
    }
  }

  return { agent, response: null }
}
