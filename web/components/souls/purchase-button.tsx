'use client'

import { useRef, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import { useAuth } from '@web/components/auth-provider'
import { selectCoinObjectIdsForAmountAcrossPages } from '@web/lib/souls/coin-selection'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { formatMirrorSyncError, mirrorRouteRequest } from '@web/lib/souls/mirror-sync'
import { usePrivySuiSign } from '@web/lib/souls/use-privy-sui'
import { buildBuyPerpetualTx, buildBuySubscriptionTx } from '@web/lib/souls/tx-builder'

interface PurchaseButtonProps {
  planType: 'onetime' | 'subscription'
  seriesOnChainId: string
  releaseOnChainId: string | null
  planId: string
  priceCents: number // price in cents from DB (e.g. 100 = $1.00)
}

function readAtomicUsdcFromPricingPlanFields(fields: Record<string, unknown>): bigint | null {
  const raw = fields.price_usdc
  if (typeof raw === 'bigint') return raw
  if (typeof raw === 'number' && Number.isFinite(raw)) return BigInt(Math.trunc(raw))
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      return BigInt(raw.trim())
    } catch {
      return null
    }
  }
  return null
}

async function getPlanAmountAtomic(
  suiClient: ReturnType<typeof useSuiClient>,
  planId: string,
): Promise<bigint> {
  const planObject = await suiClient.getObject({
    id: planId,
    options: { showContent: true },
  })

  const fields = (planObject.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields
  const amount = fields ? readAtomicUsdcFromPricingPlanFields(fields) : null
  if (!amount || amount <= 0n) {
    throw new Error('Pricing plan amount is invalid on chain. Please refresh and retry.')
  }
  return amount
}

export function PurchaseButton({
  planType,
  seriesOnChainId,
  releaseOnChainId,
  planId,
  priceCents,
}: PurchaseButtonProps) {
  const { user, getAuthHeaders } = useAuth()
  const { suiWallet, signAndExecute } = usePrivySuiSign()
  const suiClient = useSuiClient()

  const [status, setStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const purchaseInFlightRef = useRef(false)

  if (!user) {
    return (
      <a href="/login" className="glass-card px-6 py-3 text-sm font-semibold block text-center" style={{ color: 'var(--accent-cyan)' }}>
        Login to purchase
      </a>
    )
  }

  if (!suiWallet) {
    return (
      <button type="button" disabled className="glass-card px-6 py-3 text-sm font-semibold w-full" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>
        No Sui wallet found
      </button>
    )
  }

  if (planType === 'onetime' && !releaseOnChainId) {
    return (
      <div className="space-y-3">
        <button type="button" disabled className="glass-card px-6 py-3 text-sm font-semibold w-full" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>
          Release not available yet
        </button>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          One-time purchases open after the author publishes a release for this Soul.
        </p>
      </div>
    )
  }

  if (!planId) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          disabled
          className="glass-card px-6 py-3 text-sm font-semibold w-full"
          style={{ color: 'var(--text-muted)', opacity: 0.5 }}
        >
          Pricing plan unavailable
        </button>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Refresh the page or wait for the author to finish syncing pricing.
        </p>
      </div>
    )
  }

  async function handlePurchase() {
    if (!suiWallet || purchaseInFlightRef.current) return
    purchaseInFlightRef.current = true
    setErrorMsg(null)
    setTxDigest(null)
    const encodedSeriesOnChainId = encodeURIComponent(seriesOnChainId)
    let confirmedDigest: string | null = null
    try {
      setStatus('pending')
      const platformConfigId = getRequiredPublicEnv('NEXT_PUBLIC_PLATFORM_CONFIG_ID')
      const usdcCoinType = getRequiredPublicEnv('NEXT_PUBLIC_USDC_COIN_TYPE')
      const fallbackAmount = Number.isInteger(priceCents) && priceCents > 0
        ? BigInt(priceCents) * 10_000n
        : null
      const amount = await getPlanAmountAtomic(suiClient, planId).catch((error) => {
        if (fallbackAmount) return fallbackAmount
        throw error
      })
      let paymentCoinIds: string[] | null
      try {
        paymentCoinIds = await selectCoinObjectIdsForAmountAcrossPages(suiClient, {
          owner: suiWallet.address,
          coinType: usdcCoinType,
          requiredAmount: amount,
        })
      } catch {
        throw new Error('Unable to read your USDC balance from chain right now. Please retry.')
      }
      if (paymentCoinIds?.length === 0) {
        setStatus('error')
        setErrorMsg('No USDC found in wallet. Please fund your wallet with USDC first.')
        return
      }
      if (!paymentCoinIds) {
        setStatus('error')
        setErrorMsg('Not enough USDC found across available coin objects. Please fund or consolidate your wallet first.')
        return
      }

      let tx
      if (planType === 'onetime') {
        if (!releaseOnChainId) {
          setStatus('error')
          setErrorMsg('Selected release is not available yet. Please refresh and try again.')
          return
        }

        tx = buildBuyPerpetualTx({
          platformConfigId,
          planId,
          seriesId: seriesOnChainId,
          releaseId: releaseOnChainId,
          paymentCoinIds,
          amount,
        })
      } else {
        tx = buildBuySubscriptionTx({
          platformConfigId,
          planId,
          seriesId: seriesOnChainId,
          paymentCoinIds,
          amount,
        })
      }

      const result = await signAndExecute(tx)
      confirmedDigest = result.digest
      setTxDigest(result.digest)

      // Extract passId from TX result and write to DB
      const passObj = result.objectChanges?.find(
        (c: { type: string; objectType?: string }) =>
          c.type === 'created' && (c.objectType?.includes('::pass::PerpetualPass') || c.objectType?.includes('::pass::SubscriptionPass')),
      ) as { objectId?: string } | undefined
      if (!passObj?.objectId) {
        throw new Error(`Transaction confirmed, but the minted pass object was missing from the response. Tx: ${result.digest}`)
      }

      const authHeaders = await getAuthHeaders()
      await mirrorRouteRequest({
        input: `/api/souls/${encodedSeriesOnChainId}/purchase`,
        init: {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            passOnChainId: passObj.objectId,
            txDigest: result.digest,
          }),
        },
      })

      setStatus('done')
    } catch (err) {
      setErrorMsg(formatMirrorSyncError(err, confirmedDigest))
      setStatus('error')
    } finally {
      purchaseInFlightRef.current = false
    }
  }

  if (status === 'done' && txDigest) {
    return (
      <div className="space-y-2">
        <div className="glass-card px-4 py-3 text-sm text-center" style={{ color: 'var(--accent-cyan)' }}>Purchase confirmed</div>
        <p className="text-xs break-all" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Tx: {txDigest}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <button type="button" disabled={status === 'pending'} onClick={handlePurchase}
        className="glass-card px-6 py-3 text-sm font-semibold w-full transition-all"
        style={{ color: status === 'pending' ? 'var(--text-muted)' : 'var(--accent-cyan)', opacity: status === 'pending' ? 0.6 : 1, cursor: status === 'pending' ? 'not-allowed' : 'pointer' }}>
        {status === 'pending' ? 'Signing...' : planType === 'onetime' ? 'Purchase' : 'Subscribe'}
      </button>
      {status === 'error' && errorMsg && (
        <div className="space-y-1">
          <p role="alert" className="text-xs" style={{ color: 'var(--error, #f87171)' }}>{errorMsg}</p>
          {txDigest && (
            <p className="text-xs break-all" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Tx: {txDigest}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
