'use client'

import { useState } from 'react'
import { useAuth } from '@web/components/auth-provider'
import { buildBuySoulTx } from '@web/lib/souls/tx-builder'
import { mirrorRouteRequest, formatMirrorSyncError } from '@web/lib/souls/mirror-sync'
import { usePrivySuiSign } from '@web/lib/souls/use-privy-sui'
import { formatAtomicSuiForDisplay } from '@web/lib/souls/price-format'

interface PurchaseButtonProps {
  soulObjectId: string
  sellerKioskId: string
  listedPriceSui: string
  feeAmountSui: string
  quotedPriceSui?: string | null
  onPurchased?: () => Promise<void> | void
}

export function PurchaseButton(props: PurchaseButtonProps) {
  const { getAuthHeaders, user } = useAuth()
  const { signAndExecute } = usePrivySuiSign()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePurchase() {
    if (!user?.primarySuiAddress) {
      setError('请先绑定 Sui 钱包')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const tx = buildBuySoulTx({
        soulObjectId: props.soulObjectId,
        sellerKioskId: props.sellerKioskId,
        buyerAddress: user.primarySuiAddress,
        priceSui: BigInt(props.quotedPriceSui ?? props.listedPriceSui),
        feeAmountSui: BigInt(props.feeAmountSui),
      })
      const result = await signAndExecute(tx)
      const headers = await getAuthHeaders()
      await mirrorRouteRequest({
        input: `/api/souls/${encodeURIComponent(props.soulObjectId)}/purchase`,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({ txDigest: result.digest }),
        },
      })
      await props.onPurchased?.()
    } catch (purchaseError) {
      setError(formatMirrorSyncError(purchaseError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handlePurchase}
        disabled={submitting}
        className="px-4 py-3 rounded-xl font-semibold"
        style={{
          background: 'var(--accent-cyan)',
          color: '#02131a',
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? 'Purchasing…' : `Buy for ${formatAtomicSuiForDisplay((BigInt(props.quotedPriceSui ?? props.listedPriceSui) + BigInt(props.feeAmountSui)).toString())}`}
      </button>
      {error ? (
        <p className="text-sm" style={{ color: 'var(--accent-rose)' }}>{error}</p>
      ) : null}
    </div>
  )
}
