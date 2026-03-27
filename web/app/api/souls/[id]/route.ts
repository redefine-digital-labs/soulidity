import { NextResponse } from 'next/server'
import { resolveIdentity } from '@web/lib/auth/identity'
import { OnChainVerificationError } from '@web/lib/souls/on-chain-verification'
import { getSoulPurchaseQuote, getSoulSecondaryPurchaseQuote } from '@web/lib/souls/purchase-quote'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@web/lib/souls/repository'
import { suiClient } from '@web/lib/sui'
import { buildBuySecondarySoulTx } from '@web/lib/souls/tx-builder'

const DETAIL_ROUTE_DEV_INSPECT_SENDER = `0x${'1'.padStart(64, '0')}`

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
        const quote = soul.listingSource === 'core'
          ? await getSoulSecondaryPurchaseQuote({ priceSui: BigInt(soul.listedPriceSui!.toString()) })
          : await getSoulPurchaseQuote({ sellerKioskId: soul.sellerKioskId, soulObjectId: soul.onChainId })
        if (soul.listingSource === 'core') {
          const feeAmountSui = quote.totalSui - quote.priceSui
          const tx = buildBuySecondarySoulTx({
            soulObjectId: soul.onChainId,
            sellerKioskId: soul.sellerKioskId,
            buyerAddress: DETAIL_ROUTE_DEV_INSPECT_SENDER,
            priceSui: quote.priceSui,
            feeAmountSui,
          })
          tx.setSender(DETAIL_ROUTE_DEV_INSPECT_SENDER)
          const inspection = await suiClient.devInspectTransactionBlock({
            sender: DETAIL_ROUTE_DEV_INSPECT_SENDER,
            transactionBlock: tx,
          })
          if (inspection.error || (inspection.effects?.status?.status && inspection.effects.status.status !== 'success')) {
            throw new OnChainVerificationError('Soul listing is no longer active on chain')
          }
        }
        detail.purchaseFeeAmountSui = (quote.totalSui - quote.priceSui).toString()
        detail.quotedPriceSui = quote.priceSui.toString()
      }
    } catch (detailError) {
      if (!(detailError instanceof OnChainVerificationError)) {
        console.warn('[soul-detail] Failed to compute purchase fee', detailError)
      }
    }
  }

  return NextResponse.json(detail)
}
