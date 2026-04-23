import { NextResponse } from 'next/server'
import { takeRateLimitToken } from '@/lib/rate-limit'
import {
  AssetAccessDeniedError,
  resolveSoulAssetVersionAccessPayload,
} from '@/lib/soulidity/asset-version-access'
import { requireHumanWalletIdentity } from '@/lib/soulidity/server'

export const dynamic = 'force-dynamic'

const HUMAN_ASSET_ACCESS_RATE_LIMIT = {
  max: 30,
  windowMs: 60 * 1000,
} as const

function parseVersionParam(value: string) {
  if (!/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; assetName: string; versionIndex: string }> },
) {
  const { id, assetName: decodedAssetName, versionIndex } = await params
  const parsedVersionIndex = parseVersionParam(versionIndex)
  if (parsedVersionIndex == null) {
    return NextResponse.json({ error: 'versionIndex must be a non-negative integer' }, { status: 400 })
  }

  const auth = await requireHumanWalletIdentity()
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeRateLimitToken(`human-asset-access:${auth.identity.memberId}`, HUMAN_ASSET_ACCESS_RATE_LIMIT)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity asset access requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  try {
    const access = await resolveSoulAssetVersionAccessPayload({
      soulOnChainId: id,
      assetName: decodedAssetName,
      versionIndex: parsedVersionIndex,
      viewerAddresses: auth.walletAddresses,
    })
    return NextResponse.json(access)
  } catch (error) {
    if (error instanceof AssetAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
}
