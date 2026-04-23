import { NextResponse } from 'next/server'
import { hasCredentialedSealServerConfigs, hasSealSessionConfig } from '@/lib/services/seal'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { resolveSoulAccessPayload, SoulAccessDeniedError } from '@/lib/soulidity/access'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@/lib/soulidity/repository'
import { requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const HUMAN_ACCESS_RATE_LIMIT = {
  max: 30,
  windowMs: 60 * 1000,
} as const

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireHumanWalletIdentity()
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeRateLimitToken(`human-access:${auth.identity.memberId}`, HUMAN_ACCESS_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity access requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  if (!hasSealSessionConfig()) {
    return NextResponse.json({ error: 'Seal session is not configured' }, { status: 503 })
  }
  if (hasCredentialedSealServerConfigs()) {
    return NextResponse.json(
      { error: 'Credentialed Seal key servers are not supported for browser access' },
      { status: 503 },
    )
  }

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  try {
    const payload = await resolveSoulAccessPayload({
      soul: toSoulAssetDetail(soul, {
        viewerMemberId: auth.identity.memberId,
        viewerAddresses: auth.walletAddresses,
        quote: null,
      }),
      viewerAddresses: auth.walletAddresses,
      packageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'),
    })
    return NextResponse.json(payload)
  } catch (error) {
    if (error instanceof SoulAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[soul-access] Failed to resolve Soulidity access payload', {
      memberId: auth.identity.memberId,
      soulId: soul.onChainId,
      error,
    })
    return NextResponse.json({ error: 'Failed to prepare Soulidity access payload' }, { status: 500 })
  }
}
