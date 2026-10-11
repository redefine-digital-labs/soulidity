import { NextResponse } from 'next/server'
import { hasSealSessionConfig } from '@/lib/services/seal'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { ContentAccessDeniedError, resolveContentAccessPayload } from '@/lib/soulidity/access'
import { CANONICAL_SOUL_DOC_NAME, KIND_SOUL_DOC } from '@soulidity/sdk'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@/lib/soulidity/repository'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'

export const dynamic = 'force-dynamic'

const AGENT_ACCESS_RATE_LIMIT = { max: 60, windowMs: 60 * 1000 } as const

function parseContentSelector(request: Request) {
  const url = new URL(request.url)
  const rawKind = url.searchParams.get('kind')
  const rawVersionIndex = url.searchParams.get('versionIndex')

  const kind = rawKind == null || rawKind.trim() === ''
    ? KIND_SOUL_DOC
    : Number(rawKind)
  const versionIndex = rawVersionIndex == null || rawVersionIndex.trim() === ''
    ? 0
    : Number(rawVersionIndex)

  if (!Number.isInteger(kind) || kind < 0) {
    return { error: NextResponse.json({ error: 'kind must be a non-negative integer' }, { status: 400 }) }
  }
  if (!Number.isInteger(versionIndex) || versionIndex < 0) {
    return { error: NextResponse.json({ error: 'versionIndex must be a non-negative integer' }, { status: 400 }) }
  }

  return {
    selector: {
      kind,
      name: url.searchParams.get('name')?.trim() || CANONICAL_SOUL_DOC_NAME,
      versionIndex,
    },
  }
}

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
  const selectorResult = parseContentSelector(request)
  if ('error' in selectorResult) return selectorResult.error
  const selector = selectorResult.selector

  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const detail = toSoulAssetDetail(soul, {
    viewerMemberId: auth.agent.agentMemberId,
    viewerAddresses: auth.walletAddresses,
    quote: null,
  })

  const contentVersion = detail.contentVersions.find(
    (version) =>
      version.kind === selector.kind
      && version.name === selector.name
      && version.versionIndex === selector.versionIndex
      && version.deletedAt == null
      && version.purgedAt == null,
  )
  if (!contentVersion) {
    return NextResponse.json({ error: 'Requested content version is not available' }, { status: 409 })
  }

  try {
    const payload = await resolveContentAccessPayload({
      soul: {
        onChainId: detail.onChainId,
        stateOnChainId: detail.stateOnChainId,
        contentOnChainId: detail.contentOnChainId,
        paidAccessListOnChainId: detail.paidAccessListOnChainId,
      },
      version: contentVersion,
      viewerAddresses: auth.walletAddresses,
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
