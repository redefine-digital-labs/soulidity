import { NextResponse } from 'next/server'
import { resolveIdentity } from '@web/lib/auth/identity'
import { OnChainVerificationError } from '@web/lib/souls/on-chain-verification'
import { getSoulPurchaseQuote } from '@web/lib/souls/purchase-quote'
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
      if (soul.sellerKioskId) {
        const quote = await getSoulPurchaseQuote({
          sellerKioskId: soul.sellerKioskId,
          soulObjectId: soul.onChainId,
        })
        detail.purchaseFeeAmountSui = (quote.totalSui - quote.priceSui).toString()
      }
    } catch (detailError) {
      if (!(detailError instanceof OnChainVerificationError)) {
        console.warn('[soul-detail] Failed to compute purchase fee', detailError)
      }
    }
  }

  return NextResponse.json(detail)
}
