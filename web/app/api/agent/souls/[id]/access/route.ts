import { NextResponse } from 'next/server'
import { hasSealSessionConfig } from '@/lib/services/seal'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { ContentAccessDeniedError, resolveContentAccessPayload } from '@/lib/soulidity/access'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import { CANONICAL_SOUL_DOC_NAME, KIND_SOUL_DOC } from '@soulidity/sdk'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@/lib/soulidity/repository'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'

export const dynamic = 'force-dynamic'

const AGENT_ACCESS_RATE_LIMIT = { max: 60, windowMs: 60 * 1000 } as const

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgentWalletIdentity(request)
  if ('error' in auth) return auth.error

  const rateLimit = await takeRateLimitToken(
    `agent-access:${auth.agent.agentMemberId}`,
    AGENT_ACCESS_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many agent access requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  if (!hasSealSessionConfig()) {
    return NextResponse.json({ error: 'Seal session is not configured' }, { status: 503 })
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const detail = toSoulAssetDetail(soul, {
    viewerMemberId: auth.agent.agentMemberId,
    viewerAddresses: auth.walletAddresses,
    quote: null,
  })

  const soulDocVersion = detail.contentVersions.find(
    (version) =>
      version.kind === KIND_SOUL_DOC
      && version.name === CANONICAL_SOUL_DOC_NAME
      && version.versionIndex === 0
      && version.deletedAt == null
      && version.purgedAt == null,
  )
  if (!soulDocVersion) {
    return NextResponse.json({ error: 'Soul document version is not available' }, { status: 409 })
  }

  try {
    const payload = await resolveContentAccessPayload({
      soul: {
        onChainId: detail.onChainId,
        stateOnChainId: detail.stateOnChainId,
        contentOnChainId: detail.contentOnChainId,
        paidAccessListOnChainId: detail.paidAccessListOnChainId,
      },
      version: soulDocVersion,
      viewerAddresses: auth.walletAddresses,
      packageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'),
    })
    return NextResponse.json(payload)
  } catch (error: unknown) {
    if (error instanceof ContentAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[agent-soul-access] Failed', {
      agentMemberId: auth.agent.agentMemberId,
      soulId: id,
      error,
    })
    return NextResponse.json({ error: 'Failed to resolve agent access' }, { status: 500 })
  }
}
