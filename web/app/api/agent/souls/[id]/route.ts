import { NextRequest, NextResponse } from 'next/server'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { isMultipleSuiWalletBindingsError } from '@web/lib/auth/sui-wallet-errors'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@web/lib/souls/repository'

export const dynamic = 'force-dynamic'

const AGENT_SOUL_DETAIL_RATE_LIMIT = {
  max: 60,
  windowMs: 60 * 1000,
} as const

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { agent, response } = await requireAgentApiKey(req)
  if (!agent) return response

  const rateLimit = await takeRateLimitToken(`agent-detail:${agent.agentMemberId}`, AGENT_SOUL_DETAIL_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many soul detail requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let viewerWalletAddresses: string[] = []
  try {
    viewerWalletAddresses = await getMemberSuiWalletAddresses(agent.agentMemberId)
  } catch (walletError) {
    if (isMultipleSuiWalletBindingsError(walletError)) {
      return NextResponse.json({ error: walletError.message }, { status: 409 })
    }
    throw walletError
  }

  return NextResponse.json(toSoulAssetDetail(soul, {
    viewerMemberId: agent.agentMemberId,
    viewerWalletAddresses,
  }))
}
