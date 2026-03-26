'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSuiClient } from '@mysten/dapp-kit'
import { useAuth } from '@web/components/auth-provider'
import { normalizeSuiWalletAddress } from '@web/lib/auth/challenge'
import { selectCoinObjectIdsForAmountAcrossPages } from '@web/lib/souls/coin-selection'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { formatMirrorSyncError, mirrorRouteRequest } from '@web/lib/souls/mirror-sync'
import {
  createPassGrantSingleFlight,
  getDisplayedAgentGrant,
  getPassGrantSuccessMessage,
  type PassGrantUiState,
} from '@web/lib/souls/pass-grant-ui'
import { formatAtomicUsdcForDisplay, parseAtomicUsdcString } from '@web/lib/souls/price-format'
import { usePrivySuiSign } from '@web/lib/souls/use-privy-sui'
import {
  buildSetAgentGrantPerpetualTx,
  buildSetAgentGrantSubscriptionTx,
  buildRevokeAgentGrantPerpetualTx,
  buildRevokeAgentGrantSubscriptionTx,
  buildRenewSubscriptionTx,
} from '@web/lib/souls/tx-builder'
import type { SoulPassSnapshot } from '@web/lib/souls/types'

interface PassStatusProps {
  pass: SoulPassSnapshot
  seriesOnChainId?: string
  subPlanOnChainId?: string | null
  subPriceUsdc?: string | null
}

export function PassStatus({ pass, seriesOnChainId, subPlanOnChainId, subPriceUsdc }: PassStatusProps) {
  const { getAuthHeaders } = useAuth()
  const queryClient = useQueryClient()
  const suiClient = useSuiClient()
  const [, setExpiryTick] = useState(0)

  useEffect(() => {
    if (pass.passType !== 'subscription' || !pass.expiresAt) {
      return
    }

    const expiresAtMs = new Date(pass.expiresAt).getTime()
    if (!Number.isFinite(expiresAtMs)) {
      return
    }

    const delayMs = expiresAtMs - Date.now()
    if (delayMs <= 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setExpiryTick((current) => current + 1)
    }, Math.min(delayMs + 100, 2_147_483_647))

    return () => window.clearTimeout(timer)
  }, [pass.passType, pass.expiresAt])

  const isExpired =
    pass.passType === 'subscription' &&
    pass.expiresAt != null &&
    new Date(pass.expiresAt) < new Date()
  const canManageAgentGrant = !isExpired
  const canRenew = isExpired && !!seriesOnChainId && !!subPlanOnChainId && !!subPriceUsdc

  // ─── Renew state ────────────────────────────────────────────
  const [renewStatus, setRenewStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle')
  const [renewError, setRenewError] = useState<string | null>(null)
  const [renewTxDigest, setRenewTxDigest] = useState<string | null>(null)
  const renewInFlightRef = useRef(false)

  // ─── Grant state ────────────────────────────────────────────
  const [grantState, setGrantState] = useState<PassGrantUiState>('idle')
  const [agentAddress, setAgentAddress] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const [grantOverride, setGrantOverride] = useState<string | null | undefined>(undefined)
  const runExclusiveGrantActionRef = useRef(createPassGrantSingleFlight())
  const isGrantPending = grantState === 'pending'
  const concurrentGrantMessage = 'Another agent access update is already in progress. Please wait.'

  const { suiWallet, signAndExecute } = usePrivySuiSign()
  const encodedPassOnChainId = encodeURIComponent(pass.onChainId)

  // ─── Renew handler ──────────────────────────────────────────
  async function handleRenew() {
    if (!suiWallet || renewInFlightRef.current || !seriesOnChainId || !subPlanOnChainId || !subPriceUsdc) return
    renewInFlightRef.current = true
    setRenewError(null)
    setRenewTxDigest(null)
    let confirmedDigest: string | null = null
    try {
      setRenewStatus('pending')
      const platformConfigId = getRequiredPublicEnv('NEXT_PUBLIC_PLATFORM_CONFIG_ID')
      const usdcCoinType = getRequiredPublicEnv('NEXT_PUBLIC_USDC_COIN_TYPE')
      const amount = parseAtomicUsdcString(subPriceUsdc)
      if (amount <= 0n) {
        throw new Error('Pricing plan amount is invalid. Please refresh and retry.')
      }

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
        throw new Error('No USDC found in wallet. Please fund your wallet with USDC first.')
      }
      if (!paymentCoinIds) {
        throw new Error('Not enough USDC to cover this renewal.')
      }

      const tx = buildRenewSubscriptionTx({
        platformConfigId,
        planId: subPlanOnChainId,
        seriesId: seriesOnChainId,
        passId: pass.onChainId,
        paymentCoinIds,
        amount,
      })
      const result = await signAndExecute(tx)
      confirmedDigest = result.digest
      setRenewTxDigest(result.digest)

      const authHeaders = await getAuthHeaders()
      await mirrorRouteRequest({
        input: `/api/souls/${encodeURIComponent(seriesOnChainId)}/renew`,
        init: {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ passOnChainId: pass.onChainId, txDigest: result.digest }),
        },
      })

      await queryClient.invalidateQueries({ queryKey: ['soul'] })
      await queryClient.invalidateQueries({ queryKey: ['my-souls'] })
      setRenewStatus('done')
    } catch (err) {
      setRenewError(formatMirrorSyncError(err, confirmedDigest))
      setRenewStatus('error')
    } finally {
      renewInFlightRef.current = false
    }
  }

  // ─── Grant handlers ─────────────────────────────────────────
  function handleGrantClick() {
    if (!canManageAgentGrant) {
      return
    }
    setConfirmingRevoke(false)
    setGrantState('inputting')
    setAgentAddress('')
    setErrorMsg('')
  }

  function handleCancelGrant() {
    setConfirmingRevoke(false)
    setGrantState('idle')
    setAgentAddress('')
    setErrorMsg('')
  }

  async function handleConfirmGrant() {
    if (!canManageAgentGrant) {
      setErrorMsg('Renew this pass before managing agent access')
      return
    }

    const trimmed = agentAddress.trim()
    if (!trimmed) {
      setErrorMsg('Enter a Sui address')
      return
    }
    const normalizedAgentAddress = normalizeSuiWalletAddress(trimmed)
    if (!normalizedAgentAddress) {
      setErrorMsg('Invalid Sui address')
      return
    }

    try {
      const result = await runExclusiveGrantActionRef.current(async () => {
        setGrantState('pending')
        setErrorMsg('')
        const tx =
          pass.passType === 'perpetual'
            ? buildSetAgentGrantPerpetualTx({ passId: pass.onChainId, agentAddress: normalizedAgentAddress })
            : buildSetAgentGrantSubscriptionTx({ passId: pass.onChainId, agentAddress: normalizedAgentAddress })

        try {
          const result = await signAndExecute(tx)
          const headers = await getAuthHeaders()
          await mirrorRouteRequest({
            input: `/api/souls/passes/${encodedPassOnChainId}/grant`,
            init: {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ agentAddress: normalizedAgentAddress, txDigest: result.digest }),
            },
          })
          await queryClient.invalidateQueries({ queryKey: ['my-souls'] })
          setGrantOverride(normalizedAgentAddress)
          setGrantState('grant-success')
          return true
        } catch (err) {
          setErrorMsg(formatMirrorSyncError(err))
          setGrantState('error')
          return false
        }
      })
      if (result === undefined) {
        setErrorMsg(concurrentGrantMessage)
      }
    } catch (err) {
      setErrorMsg(formatMirrorSyncError(err))
      setGrantState('error')
    }
  }

  function handleRevokeClick() {
    if (!canManageAgentGrant) {
      return
    }
    setConfirmingRevoke(true)
    setErrorMsg('')
  }

  function handleCancelRevoke() {
    if (isGrantPending) {
      return
    }
    setConfirmingRevoke(false)
  }

  async function handleConfirmRevoke() {
    if (!canManageAgentGrant) {
      return
    }

    setConfirmingRevoke(false)

    try {
      const result = await runExclusiveGrantActionRef.current(async () => {
        setGrantState('pending')
        setErrorMsg('')
        const tx =
          pass.passType === 'perpetual'
            ? buildRevokeAgentGrantPerpetualTx({ passId: pass.onChainId })
            : buildRevokeAgentGrantSubscriptionTx({ passId: pass.onChainId })

        try {
          const result = await signAndExecute(tx)
          const headers = await getAuthHeaders()
          await mirrorRouteRequest({
            input: `/api/souls/passes/${encodedPassOnChainId}/grant`,
            init: {
              method: 'DELETE',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ txDigest: result.digest }),
            },
          })
          await queryClient.invalidateQueries({ queryKey: ['my-souls'] })
          setGrantOverride(null)
          setGrantState('revoke-success')
          return true
        } catch (err) {
          setErrorMsg(formatMirrorSyncError(err))
          setGrantState('error')
          return false
        }
      })
      if (result === undefined) {
        setErrorMsg(concurrentGrantMessage)
      }
    } catch (err) {
      setErrorMsg(formatMirrorSyncError(err))
      setGrantState('error')
    }
  }

  const grantedAddress = getDisplayedAgentGrant(pass.agentGrant, grantOverride)
  const successMessage = getPassGrantSuccessMessage(grantState)

  useEffect(() => {
    if (grantState !== 'grant-success' && grantState !== 'revoke-success') {
      return
    }

    const timer = window.setTimeout(() => {
      setGrantState('idle')
    }, 4_000)

    return () => window.clearTimeout(timer)
  }, [grantState])

  return (
    <div className="glass-card p-4 space-y-2">
      {/* Pass type + status badge */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Your Pass
        </span>
        <span
          className="badge text-xs"
          style={{
            background: isExpired ? 'var(--accent-rose-dim)' : 'var(--accent-cyan-dim)',
            color: isExpired ? 'var(--accent-rose)' : 'var(--accent-cyan)',
          }}
        >
          {isExpired ? 'Expired' : pass.passType === 'perpetual' ? 'Perpetual' : 'Active'}
        </span>
      </div>

      {/* Expiry */}
      {pass.passType === 'subscription' && pass.expiresAt && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {isExpired ? 'Expired' : 'Expires'}: {new Date(pass.expiresAt).toLocaleDateString()}
        </p>
      )}

      {/* Renew section */}
      {canRenew && (
        <div className="space-y-2 pt-1">
          {renewStatus === 'done' && renewTxDigest ? (
            <>
              <p className="text-xs" style={{ color: 'var(--accent-cyan)' }}>Renewal confirmed</p>
              <p className="text-xs break-all" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Tx: {renewTxDigest}
              </p>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary text-xs w-full"
                disabled={renewStatus === 'pending'}
                onClick={handleRenew}
              >
                {renewStatus === 'pending' ? 'Renewing…' : `Renew — ${formatAtomicUsdcForDisplay(subPriceUsdc)}`}
              </button>
              {renewStatus === 'error' && renewError && (
                <p role="alert" className="text-xs" style={{ color: 'var(--accent-rose)' }}>{renewError}</p>
              )}
            </>
          )}
        </div>
      )}

      {/* Agent grant section */}
      {grantedAddress && grantState !== 'grant-success' && grantState !== 'revoke-success' ? (
        <div className="space-y-2 pt-1">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Agent Grant:
          </p>
          <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            {grantedAddress.slice(0, 8)}...{grantedAddress.slice(-6)}
          </p>
          {confirmingRevoke ? (
            <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Revoke this agent grant? The agent will immediately lose access after the on-chain transaction succeeds.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary text-xs"
                  disabled={isGrantPending || !canManageAgentGrant}
                  onClick={handleConfirmRevoke}
                >
                  Confirm Revoke
                </button>
                <button
                  type="button"
                  className="btn btn-surface text-xs"
                  disabled={isGrantPending}
                  onClick={handleCancelRevoke}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-surface text-xs"
              disabled={isGrantPending || !canManageAgentGrant}
              onClick={handleRevokeClick}
            >
              {isGrantPending ? 'Revoking…' : 'Revoke'}
            </button>
          )}
          {!canManageAgentGrant && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Renew this pass to manage agent access.
            </p>
          )}
          {errorMsg && (
            <p role="alert" className="text-xs" style={{ color: 'var(--accent-rose)' }}>
              {errorMsg}
            </p>
          )}
        </div>
      ) : successMessage ? (
        <div className="space-y-1 pt-1">
          <p className="text-xs" style={{ color: 'var(--accent-cyan)' }}>
            {successMessage}
          </p>
        </div>
      ) : grantState === 'inputting' || grantState === 'error' ? (
        <div className="space-y-2 pt-1">
          <input
            className="input-dark w-full text-xs"
            aria-label="Agent Sui address"
            placeholder="Agent Sui address (0x…)"
            value={agentAddress}
            onChange={(e) => setAgentAddress(e.target.value)}
          />
          {errorMsg && (
            <p role="alert" className="text-xs" style={{ color: 'var(--accent-rose)' }}>
              {errorMsg}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary text-xs" onClick={handleConfirmGrant} disabled={isGrantPending || !canManageAgentGrant}>
              Confirm Grant
            </button>
            <button type="button" className="btn btn-surface text-xs" onClick={handleCancelGrant}>
              Cancel
            </button>
          </div>
        </div>
      ) : grantState === 'pending' ? (
        <p className="text-xs pt-1" style={{ color: 'var(--text-muted)' }}>
          Signing transaction…
        </p>
      ) : !canManageAgentGrant ? (
        <p className="text-xs pt-1" style={{ color: 'var(--text-muted)' }}>
          Renew this pass to manage agent access.
        </p>
      ) : (
        /* idle, no existing grant */
        <button type="button" className="btn btn-surface text-xs mt-1" onClick={handleGrantClick}>
          Grant Agent
        </button>
      )}
    </div>
  )
}
