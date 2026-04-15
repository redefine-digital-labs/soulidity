'use client'

import { useEffect, useRef, useState } from 'react'
import type { Transaction } from '@mysten/sui/transactions'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import { buildPublishSoulTx } from '@/lib/soulidity/tx/publish'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
import { useAuth } from '@/components/providers/auth-provider'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@/lib/soulidity/client-session'
import { normalizeTags } from '@/lib/soulidity/tags'

const MINT_RECOVERY_KEY = 'soul-mint-recovery'

interface MintRecoveryState {
  userId: string
  txDigest: string
  syncBody: Record<string, unknown>
  deploymentSignature: string
}

export type PublishStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

export interface PublishSyncResponse {
  txDigest: string
  soulOnChainId: string
  stateOnChainId: string
  memoryOnChainId: string
  listingStatus: string
}

export interface PublishParams {
  name: string
  description: string
  tags: string[]
  imageUrl: string
  metadataRef?: string | null
  previewImages: string[]
  readme?: string | null
  protectedBlobObjectId: string
  foundingMemoryBlobObjectId?: string | null
  skillsBlobObjectId?: string | null
  initialSkillName?: string | null
  skillsVisibility?: 'public' | 'private'
  skillsSealSidecar?: string | null
  memorySealSidecar?: string | null
  creatorRoyaltyBps: number
  sealSidecar?: string | null
}

async function resolvePersonalKiosk(headers: Record<string, string>, walletAddress: string) {
  const url = `/api/souls/personal-kiosk?walletAddress=${encodeURIComponent(walletAddress)}`
  const res = await fetch(url, { cache: 'no-store', headers })
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to resolve personal kiosk')
  }
  return res.json()
}

export function usePublish() {
  const [status, setStatus] = useState<PublishStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const [publishData, setPublishData] = useState<PublishSyncResponse | null>(null)
  const { suiWallet, signAndExecute, suiClient } = usePrivySuiSign()
  const { getAuthHeaders, user } = useAuth()
  const recoveryRef = useRef<MintRecoveryState | null>(null)

  // Hydrate pending mint recovery state from sessionStorage (survives page refresh)
  // Scoped to authenticated user — discard cross-user stale state
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(MINT_RECOVERY_KEY)
      if (raw) {
        const recovery: MintRecoveryState = JSON.parse(raw)
        if (recovery.txDigest && recovery.syncBody && recovery.userId === user?.id && hasCurrentSoulidityDeploymentSignature(recovery)) {
          recoveryRef.current = recovery
          setTxDigest(recovery.txDigest)
        } else {
          sessionStorage.removeItem(MINT_RECOVERY_KEY)
        }
      }
    } catch { /* ignore corrupt/missing storage */ }
  }, [user?.id])

  async function publish(params: PublishParams) {
    if (!suiWallet) {
      setError('Please sign in first')
      setStatus('error')
      return
    }

    try {
      setError(null)
      const authHeaders = await getAuthHeaders()

      // Resume sync for an already-executed mint TX (e.g. after a transient sync failure or page refresh)
      let digest = txDigest
      if (!digest) {
        setStatus('building')
        const personalKiosk = await resolvePersonalKiosk(authHeaders, suiWallet.address)
        await assertObjectInputsExist(suiClient, {
          'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
          'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
          'Soul character blob': params.protectedBlobObjectId,
          'Founding memory blob': params.foundingMemoryBlobObjectId ?? null,
          'Skills blob': params.skillsBlobObjectId ?? null,
        })
        const tx: Transaction = buildPublishSoulTx({
          currentKioskId: personalKiosk?.currentKioskId ?? null,
          currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
          name: params.name,
          description: params.description,
          imageUrl: params.imageUrl,
          metadataRef: params.metadataRef ?? null,
          protectedBlobObjectId: params.protectedBlobObjectId,
          foundingMemoryBlobObjectId: params.foundingMemoryBlobObjectId ?? null,
          skillsBlobObjectId: params.skillsBlobObjectId ?? null,
          initialSkillName: params.initialSkillName ?? null,
          skillsVisibility: params.skillsVisibility ?? 'private',
          creatorRoyaltyBps: params.creatorRoyaltyBps,
        })

        setStatus('signing')
        const result = await signAndExecute(tx)
        const executedDigest = result.digest
        digest = executedDigest
        setTxDigest(executedDigest)

        // Persist recovery state before sync — survives page refresh to prevent duplicate mints
        const syncBody = {
          txDigest: executedDigest,
          tags: normalizeTags(params.tags),
          previewImages: params.previewImages,
          readme: params.readme ?? null,
          sealSidecar: params.sealSidecar ?? null,
          memorySealSidecar: params.memorySealSidecar ?? null,
          skillsSealSidecar: params.skillsSealSidecar ?? null,
        }
        recoveryRef.current = attachSoulidityDeploymentSignature({ userId: user?.id ?? '', txDigest: executedDigest, syncBody })
        try { sessionStorage.setItem(MINT_RECOVERY_KEY, JSON.stringify(recoveryRef.current)) } catch {}
      }

      // Use recovered sync body when available (preserves original metadata after refresh),
      // otherwise build from caller params (same-tab retry with in-memory txDigest)
      const syncBody = recoveryRef.current?.txDigest === digest
        ? recoveryRef.current.syncBody
        : {
            txDigest: digest,
            tags: normalizeTags(params.tags),
            previewImages: params.previewImages,
            readme: params.readme ?? null,
            sealSidecar: params.sealSidecar ?? null,
            memorySealSidecar: params.memorySealSidecar ?? null,
            skillsSealSidecar: params.skillsSealSidecar ?? null,
          }

      setStatus('syncing')
      const syncRes = await fetch('/api/souls/publish', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(syncBody),
      })
      if (!syncRes.ok) {
        const body = await syncRes.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror publish')
      }

      const syncData: PublishSyncResponse = await syncRes.json()
      setPublishData(syncData)
      setStatus('done')

      // Clear recovery state on successful sync
      recoveryRef.current = null
      try { sessionStorage.removeItem(MINT_RECOVERY_KEY) } catch {}
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Publish failed')
      setStatus('error')
    }
  }

  return { status, error, txDigest, publishData, publish, suiWallet }
}
