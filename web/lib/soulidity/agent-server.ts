import { NextResponse } from 'next/server'
import { resolveAgentByApiKey, type AgentIdentity } from '@/lib/auth/resolve-agent'
import { getMemberSuiWalletAddresses } from '@/lib/auth/sui-wallet'
import { getAnonymousRateLimitFingerprint, getRequestIp, takeRateLimitToken } from '@/lib/rate-limit'

const FAILED_AGENT_AUTH_LIMIT = { max: 60, windowMs: 60 * 1000 } as const

function errorResponse(body: { error: string }, status: number) {
  return NextResponse.json(body, { status })
}

async function rateLimitFailedAuth(request: Request) {
  const ip = getRequestIp(new Headers(request.headers))
  const fingerprint = getAnonymousRateLimitFingerprint(new Headers(request.headers))
  const bucketKey = ip
    ? `agent-auth-failed:${ip}`
    : fingerprint
      ? `agent-auth-failed:anon:${fingerprint}`
      : 'agent-auth-failed:unknown'

  const rl = await takeRateLimitToken(bucketKey, FAILED_AGENT_AUTH_LIMIT)
  if (rl.limited) {
    return errorResponse({ error: 'Too many invalid API key attempts' }, 429)
  }
  return errorResponse({ error: 'Unauthorized' }, 401)
}

export async function requireAgentWalletIdentity(
  request: Request,
): Promise<
  | { agent: AgentIdentity; walletAddresses: string[] }
  | { error: NextResponse }
> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return { error: errorResponse({ error: 'Unauthorized' }, 401) }
  }

  if (!authHeader.startsWith('Bearer sk-')) {
    return { error: await rateLimitFailedAuth(request) }
  }

  const apiKey = authHeader.slice(7)
  const agent = await resolveAgentByApiKey(apiKey)
  if (!agent) {
    return { error: await rateLimitFailedAuth(request) }
  }

  let walletAddresses: string[]
  try {
    walletAddresses = await getMemberSuiWalletAddresses(agent.agentMemberId)
  } catch {
    return { error: errorResponse({ error: 'Failed to resolve agent wallet' }, 500) }
  }

  if (walletAddresses.length === 0) {
    return { error: errorResponse({ error: 'Agent has no bound Sui wallet' }, 403) }
  }

  return { agent, walletAddresses }
}
