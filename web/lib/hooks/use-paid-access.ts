'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  assertSoulidityTxSucceeded,
  assertObjectInputsExist,
  buildRevokePaidAccessTx,
  getConfiguredSoulidityNetwork,
} from '@soulidity/sdk'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'
import {
  clearPaidAccessRevokePending,
  persistPaidAccessRevokePending,
  readPaidAccessRevokePendingForSoul,
  type PaidAccessRevokePendingRecord,
} from '@/lib/upload/walrus-recovery'

/** Minimal soul shape required by the paid-access hook. */
export interface PaidAccessSoul {
  onChainId: string
  stateOnChainId: string
  paidAccessListOnChainId: string | null
}

export interface UsePaidAccessOptions {
  onSynced?: () => void
}

type PaidAccessPendingAction = 'revoke' | 'recovering'

function resolveNetwork(): 'testnet' | 'mainnet' | null {
  const network = getConfiguredSoulidityNetwork()
  return network === 'testnet' || network === 'mainnet' ? network : null
}

function samePendingTarget(record: PaidAccessRevokePendingRecord, buyerAddress: string, kind: number) {
  return record.buyerAddress.toLowerCase() === buyerAddress.toLowerCase() && record.kind === kind
}

export function usePaidAccess(soul: PaidAccessSoul | null, { onSynced }: UsePaidAccessOptions = {}) {
  const [pending, setPending] = useState<PaidAccessPendingAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
  const { getAuthHeaders } = useAuth()

  const postRevokeSync = useCallback(async (params: {
    txDigest: string
    buyerAddress: string
    kind: number
  }) => {
    if (!soul) throw new Error('Soul is not loaded')
    const authHeaders = await getAuthHeaders()
    const res = await fetch(`/api/souls/${encodeURIComponent(soul.onChainId)}/paid-access`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'revoke',
        txDigest: params.txDigest,
        buyerAddress: params.buyerAddress,
        kind: params.kind,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Failed to mirror paid-access revoke')
    }
    return res.json()
  }, [getAuthHeaders, soul])

  const replayPendingRecord = useCallback(async (record: PaidAccessRevokePendingRecord) => {
    const result = await postRevokeSync({
      txDigest: record.txDigest,
      buyerAddress: record.buyerAddress,
      kind: record.kind,
    })
    clearPaidAccessRevokePending(record.txDigest)
    return result
  }, [postRevokeSync])

  useEffect(() => {
    if (!soul || !suiWallet?.address) return
    const network = resolveNetwork()
    if (!network) return
    const records = readPaidAccessRevokePendingForSoul({
      soulOnChainId: soul.onChainId,
      walletAddress: suiWallet.address,
      network,
    })
    if (records.length === 0) return

    let cancelled = false
    void (async () => {
      setPending('recovering')
      let anyReplayed = false
      try {
        for (const record of records) {
          if (cancelled) return
          try {
            await replayPendingRecord(record)
            anyReplayed = true
          } catch (replayError) {
            console.warn('[paid-access-revoke-replay] failed; will retry on next mount', {
              soulOnChainId: record.soulOnChainId,
              txDigest: record.txDigest,
              error: replayError instanceof Error ? replayError.message : String(replayError),
            })
          }
        }
        if (anyReplayed && !cancelled) onSynced?.()
      } finally {
        if (!cancelled) setPending(null)
      }
    })()

    return () => { cancelled = true }
  }, [onSynced, replayPendingRecord, soul, suiWallet?.address])

  async function revokePaidAccess(buyerAddress: string, kind: number) {
    if (!soul || !suiWallet) {
      throw new Error('Sign in and load the Soul before revoking paid access')
    }
    if (!soul.paidAccessListOnChainId) {
      throw new Error('Soul has no paid-access list bound')
    }

    const network = resolveNetwork()
    if (!network) {
      throw new Error('Soulidity network is not configured')
    }

    setPending('recovering')
    setError(null)
    try {
      const pendingRecords = readPaidAccessRevokePendingForSoul({
        soulOnChainId: soul.onChainId,
        walletAddress: suiWallet.address,
        network,
      }).filter((record) => samePendingTarget(record, buyerAddress, kind))
      if (pendingRecords.length > 0) {
        let result: unknown = null
        for (const record of pendingRecords) {
          result = await replayPendingRecord(record)
        }
        onSynced?.()
        return result
      }

      setPending('revoke')
      await getAuthHeaders()
      await assertObjectInputsExist(suiClient, {
        'Soul state': soul.stateOnChainId,
        'Paid-access list': soul.paidAccessListOnChainId,
      })
      const tx = buildRevokePaidAccessTx({
        paidAccessListObjectId: soul.paidAccessListOnChainId,
        stateObjectId: soul.stateOnChainId,
        granteeAddress: buyerAddress,
        kind,
      })
      const result = await signAndExecute(tx)
      const executed = assertSoulidityTxSucceeded(result, 'Paid-access revoke transaction')
      persistPaidAccessRevokePending({
        soulOnChainId: soul.onChainId,
        txDigest: executed.digest,
        buyerAddress,
        kind,
        walletAddress: suiWallet.address,
        network,
      })
      const synced = await postRevokeSync({ txDigest: executed.digest, buyerAddress, kind })
      clearPaidAccessRevokePending(executed.digest)
      onSynced?.()
      return synced
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Paid-access revoke failed')
      throw nextError
    } finally {
      setPending(null)
    }
  }

  return { pending, error, revokePaidAccess }
}
