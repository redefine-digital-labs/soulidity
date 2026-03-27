import { NextResponse } from 'next/server'
import { resolveIdentity } from '@web/lib/auth/identity'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { getVerifiedMarketConfigState, OnChainVerificationError } from '@web/lib/souls/on-chain-verification'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@web/lib/souls/repository'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const [identity, soul] = await Promise.all([
    resolveIdentity(),
    findSoulAssetDetailByRouteId(id),
  ])

  if (!soul) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const detail = toSoulAssetDetail(soul, identity?.memberId ?? null)

  if (soul.listingStatus === 'listed' && soul.listedPriceSui != null) {
    try {
      const soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
      const marketConfigId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID')
      const marketConfig = await getVerifiedMarketConfigState(marketConfigId, soulPackageId)
      const priceSui = BigInt(soul.listedPriceSui.toString())
      const feeAmountSui =
        (priceSui * marketConfig.platformFeeBps) / 10_000n
        + (priceSui * marketConfig.royaltyBps) / 10_000n
      detail.purchaseFeeAmountSui = feeAmountSui.toString()
    } catch (detailError) {
      if (!(detailError instanceof OnChainVerificationError)) {
        console.warn('[soul-detail] Failed to compute purchase fee', detailError)
      }
    }
  }

  return NextResponse.json(detail)
}
