'use client'

import { useEffect, useRef, useState } from 'react'
import type { Transaction } from '@mysten/sui/transactions'
import { buildImportSoulTx } from '@/lib/soulidity/tx/import'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
import { useAuth } from '@/components/providers/auth-provider'

const IMPORT_RECOVERY_KEY = 'soul-import-recovery'

interface ImportRecoveryState {
  userId: string
  txDigest: string
  syncBody: Record<string, unknown>
}

export type ImportStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

export interface ImportSyncResponse {
  txDigest: string
  soulOnChainId: string
  provenanceKind: string
  originRef: string
}

export interface ImportParams {
  name: string
  description: string
  category: string
  tags: string[]
  imageUrl: string
  metadataRef?: string | null
  previewImages: string[]
  readme?: string | null
  protectedBlobObjectId: string
  foundingMemoryBlobObjectId?: string | null
  skillsBlobObjectId?: string | null
  skillsVisibility?: 'public' | 'private'
  originRef: string
  creatorRoyaltyBps: number
  sealSidecar?: object | null
  skillsSealSidecar?: object | null
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

export function useImport() {
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const [importData, setImportData] = useState<ImportSyncResponse | null>(null)
  const { suiWallet, signAndExecute } = usePrivySuiSign()
  const { getAuthHeaders, user } = useAuth()
  const recoveryRef = useRef<ImportRecoveryState | null>(null)

  // Hydrate pending recovery state from sessionStorage
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(IMPORT_RECOVERY_KEY)
      if (raw) {
        const recovery: ImportRecoveryState = JSON.parse(raw)
        if (recovery.txDigest && recovery.syncBody && recovery.userId === user?.id) {
          recoveryRef.current = recovery
          setTxDigest(recovery.txDigest)
        } else if (user?.id) {
          // Only clear when a different authenticated user is confirmed, not during auth loading
          sessionStorage.removeItem(IMPORT_RECOVERY_KEY)
        }
      }
    } catch { /* ignore */ }
  }, [user?.id])

  async function importSoul(params: ImportParams) {
    if (!suiWallet) {
      setError('Please sign in first')
      setStatus('error')
      return
    }

    try {
      setError(null)
      const authHeaders = await getAuthHeaders()

      let digest = txDigest
      if (!digest) {
        setStatus('building')
        const personalKiosk = await resolvePersonalKiosk(authHeaders, suiWallet.address)
        const tx: Transaction = buildImportSoulTx({
          currentKioskId: personalKiosk?.currentKioskId ?? null,
          currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
          name: params.name,
          description: params.description,
          imageUrl: params.imageUrl,
          metadataRef: params.metadataRef ?? null,
          protectedBlobObjectId: params.protectedBlobObjectId,
          foundingMemoryBlobObjectId: params.foundingMemoryBlobObjectId ?? null,
          skillsBlobObjectId: params.skillsBlobObjectId ?? null,
          skillsVisibility: params.skillsVisibility ?? 'private',
          originRef: params.originRef,
          creatorRoyaltyBps: params.creatorRoyaltyBps,
        })

        setStatus('signing')
        const result = await signAndExecute(tx)
        const executedDigest = result.digest
        digest = executedDigest
        setTxDigest(executedDigest)

        // Persist recovery state before sync
        const syncBody = {
          txDigest: executedDigest,
          category: params.category,
          tags: params.tags,
          previewImages: params.previewImages,
          readme: params.readme ?? null,
          sealSidecar: params.sealSidecar ?? null,
          skillsSealSidecar: params.skillsSealSidecar ?? null,
        }
        recoveryRef.current = { userId: user?.id ?? '', txDigest: executedDigest, syncBody }
        try { sessionStorage.setItem(IMPORT_RECOVERY_KEY, JSON.stringify(recoveryRef.current)) } catch {}
      }

      // Use recovered sync body when available
      const syncBody = recoveryRef.current?.txDigest === digest
        ? recoveryRef.current.syncBody
        : {
            txDigest: digest,
            category: params.category,
            tags: params.tags,
            previewImages: params.previewImages,
            readme: params.readme ?? null,
            sealSidecar: params.sealSidecar ?? null,
            skillsSealSidecar: params.skillsSealSidecar ?? null,
          }

      setStatus('syncing')
      const syncRes = await fetch('/api/import', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(syncBody),
      })
      if (!syncRes.ok) {
        const body = await syncRes.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror import')
      }

      const syncData: ImportSyncResponse = await syncRes.json()
      setImportData(syncData)
      setStatus('done')

      // Clear recovery on success
      recoveryRef.current = null
      try { sessionStorage.removeItem(IMPORT_RECOVERY_KEY) } catch {}
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Import failed')
      setStatus('error')
    }
  }

  return { status, error, txDigest, importData, importSoul, suiWallet }
}
