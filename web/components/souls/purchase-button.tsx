'use client'

import { useEffect, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import { useAuth } from '@web/components/auth-provider'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { CoinPaginationExhaustedError, selectCoinObjectIdsForAmountAcrossPages } from '@web/lib/souls/coin-selection'
import { parsePurchaseAmounts } from '@web/lib/souls/purchase-amounts'
import { buildBuySoulTx, buildInitSoulPersonalKioskTx } from '@web/lib/souls/tx-builder'
import { mirrorRouteRequest, formatMirrorSyncError } from '@web/lib/souls/mirror-sync'
import { usePrivySuiSign } from '@web/lib/souls/use-privy-sui'
import { formatAtomicSoulPaymentForDisplay } from '@web/lib/souls/price-format'

interface PurchaseButtonProps {
  soulObjectId: string
  listingObjectId: string
  sellerKioskId: string
  listedPriceAtomic: string
  purchasePlatformFeeAtomic: string
  purchaseCreatorRoyaltyAtomic: string
  purchaseTotalAtomic?: string | null
  quotedPriceAtomic?: string | null
  onPurchased?: () => Promise<void> | void
}

function getPaymentCoinSymbol(coinType: string) {
  const parts = coinType.split('::')
  return parts.at(-1) ?? 'payment coin'
}

function getPaymentCoinSelectionError(coinType: string, paymentCoinObjectIds: string[] | null) {
  const symbol = getPaymentCoinSymbol(coinType)
  return paymentCoinObjectIds === null
    ? `Insufficient ${symbol} balance for purchase`
    : `No ${symbol} found in your wallet. You may need to acquire some first.`
}

function getCoinPaginationExhaustedMessage(coinType: string) {
  return `Too many ${getPaymentCoinSymbol(coinType)} coin objects to purchase automatically. Consolidate them and try again.`
}

type PersonalKioskStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error'

type PersonalKioskRefreshResult =
  | { status: 'idle' }
  | { status: 'ready'; currentKioskId: string; currentKioskCapOnChainId: string }
  | { status: 'missing' | 'error'; message: string }

export function PurchaseButton(props: PurchaseButtonProps) {
  const { getAuthHeaders, user } = useAuth()
  const { signAndExecute } = usePrivySuiSign()
  const suiClient = useSuiClient()
  const [submitting, setSubmitting] = useState(false)
  const [initializingKiosk, setInitializingKiosk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [personalKioskStatus, setPersonalKioskStatus] = useState<PersonalKioskStatus>('idle')
  const [buyerKioskId, setBuyerKioskId] = useState<string | null>(null)
  const [buyerKioskCapOnChainId, setBuyerKioskCapOnChainId] = useState<string | null>(null)
  const parsedAmounts = parsePurchaseAmounts(props)

  async function refreshPersonalKiosk(): Promise<PersonalKioskRefreshResult> {
    if (!user?.primarySuiAddress) {
      setPersonalKioskStatus('idle')
      setBuyerKioskId(null)
      setBuyerKioskCapOnChainId(null)
      setError(null)
      return { status: 'idle' }
    }

    setPersonalKioskStatus('loading')
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const response = await fetch('/api/souls/personal-kiosk', { headers })
      if (response.ok) {
        const payload = await response.json() as {
          currentKioskId?: string
          currentKioskCapOnChainId?: string
        }
        if (typeof payload.currentKioskId === 'string' && typeof payload.currentKioskCapOnChainId === 'string') {
          setBuyerKioskId(payload.currentKioskId)
          setBuyerKioskCapOnChainId(payload.currentKioskCapOnChainId)
          setPersonalKioskStatus('ready')
          return {
            status: 'ready',
            currentKioskId: payload.currentKioskId,
            currentKioskCapOnChainId: payload.currentKioskCapOnChainId,
          }
        }
        setPersonalKioskStatus('error')
        setError('Soul personal kiosk response was incomplete')
        return { status: 'error', message: 'Soul personal kiosk response was incomplete' }
      }

      const payload = await response.json().catch(() => null)
      const message = typeof payload?.error === 'string' ? payload.error : 'Unable to resolve Soul personal kiosk right now'
      setBuyerKioskId(null)
      setBuyerKioskCapOnChainId(null)
      if (response.status === 404) {
        setPersonalKioskStatus('missing')
        setError(message)
        return { status: 'missing', message }
      }
      setPersonalKioskStatus('error')
      setError(message)
      return { status: 'error', message }
    } catch (refreshError) {
      const message = formatMirrorSyncError(refreshError)
      setBuyerKioskId(null)
      setBuyerKioskCapOnChainId(null)
      setPersonalKioskStatus('error')
      setError(message)
      return { status: 'error', message }
    }
  }

  useEffect(() => {
    void refreshPersonalKiosk()
    // user address is the capability boundary; headers helper is stable enough for this usage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.primarySuiAddress])

  async function handleInitializeKiosk() {
    if (initializingKiosk) return
    if (!user?.primarySuiAddress) {
      setError('Bind a Sui wallet before initializing a Soul kiosk')
      return
    }

    setInitializingKiosk(true)
    setError(null)
    try {
      const currentPersonalKiosk = await refreshPersonalKiosk()
      if (currentPersonalKiosk.status === 'ready') {
        return
      }
      if (currentPersonalKiosk.status !== 'missing') {
        return
      }

      const tx = buildInitSoulPersonalKioskTx()
      await signAndExecute(tx)
      await refreshPersonalKiosk()
    } catch (initError) {
      setError(formatMirrorSyncError(initError))
    } finally {
      setInitializingKiosk(false)
    }
  }

  async function handlePurchase() {
    if (submitting) return
    if (!user?.primarySuiAddress) {
      setError('Bind a Sui wallet before purchasing')
      return
    }
    if (!parsedAmounts) {
      setError('Listing price is unavailable right now')
      return
    }
    if (personalKioskStatus === 'loading') {
      setError('Checking your Soul personal kiosk, try again in a moment')
      return
    }
    if (personalKioskStatus === 'missing') {
      setError('Initialize a Soul personal kiosk before purchasing')
      return
    }
    if (!buyerKioskId || !buyerKioskCapOnChainId) {
      setError('Soul personal kiosk is unavailable right now')
      return
    }

    setSubmitting(true)
    setError(null)
    let paymentCoinType: string | null = null
    try {
      paymentCoinType = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE')
      const paymentCoinObjectIds = await selectCoinObjectIdsForAmountAcrossPages(suiClient, {
        owner: user.primarySuiAddress,
        coinType: paymentCoinType,
        requiredAmount: parsedAmounts.totalAtomic,
      })
      if (!paymentCoinObjectIds || paymentCoinObjectIds.length === 0) {
        setError(getPaymentCoinSelectionError(paymentCoinType, paymentCoinObjectIds))
        return
      }

      const txParams = {
        listingObjectId: props.listingObjectId,
        sellerKioskId: props.sellerKioskId,
        buyerKioskId,
        buyerKioskCapOnChainId,
        totalAtomic: parsedAmounts.totalAtomic,
        paymentCoinObjectIds,
      }
      const tx = buildBuySoulTx(txParams)
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
      if (purchaseError instanceof CoinPaginationExhaustedError) {
        setError(getCoinPaginationExhaustedMessage(paymentCoinType ?? 'payment coin'))
        return
      }
      setError(formatMirrorSyncError(purchaseError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {personalKioskStatus === 'missing' ? (
        <button
          type="button"
          onClick={handleInitializeKiosk}
          disabled={initializingKiosk}
          className="px-4 py-3 rounded-xl font-semibold border"
          style={{
            borderColor: 'var(--accent-cyan)',
            color: 'var(--accent-cyan)',
            opacity: initializingKiosk ? 0.7 : 1,
          }}
        >
          {initializingKiosk ? 'Initializing Soul kiosk…' : 'Initialize Soul kiosk'}
        </button>
      ) : null}
      <button
        type="button"
        onClick={handlePurchase}
        disabled={submitting || !parsedAmounts || personalKioskStatus !== 'ready'}
        className="px-4 py-3 rounded-xl font-semibold"
        style={{
          background: 'var(--accent-cyan)',
          color: '#02131a',
          opacity: submitting || !parsedAmounts || personalKioskStatus !== 'ready' ? 0.7 : 1,
        }}
      >
        {submitting
          ? 'Purchasing…'
          : personalKioskStatus === 'loading'
            ? 'Checking Soul kiosk…'
            : personalKioskStatus === 'missing'
              ? 'Initialize kiosk to buy'
              : parsedAmounts
            ? `Buy for ${formatAtomicSoulPaymentForDisplay(parsedAmounts.totalAtomic.toString())}`
            : 'Price unavailable'}
      </button>
      {error ? (
        <p className="text-sm" style={{ color: 'var(--accent-rose)' }}>{error}</p>
      ) : null}
    </div>
  )
}
