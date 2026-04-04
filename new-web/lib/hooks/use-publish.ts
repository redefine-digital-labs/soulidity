'use client'

import { useState } from 'react'
import type { Transaction } from '@mysten/sui/transactions'
import { buildPublishSoulTx } from '@/lib/soulidity/tx/publish'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
import { useAuth } from '@/components/providers/auth-provider'

export type PublishStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

export interface PublishParams {
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
  skillsSealSidecar?: object | null
  creatorRoyaltyBps: number
  sealSidecar?: object | null
}

async function resolvePersonalKiosk(headers: Record<string, string>) {
  const res = await fetch('/api/souls/personal-kiosk', { cache: 'no-store', headers })
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
  const { suiWallet, signAndExecute } = usePrivySuiSign()
  const { getAuthHeaders } = useAuth()

  async function publish(params: PublishParams) {
    if (!suiWallet) {
      setError('Please sign in first')
      setStatus('error')
      return
    }

    try {
      setStatus('building')
      setError(null)
      const authHeaders = await getAuthHeaders()
      const personalKiosk = await resolvePersonalKiosk(authHeaders)
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
        skillsVisibility: params.skillsVisibility ?? 'private',
        creatorRoyaltyBps: params.creatorRoyaltyBps,
      })

      setStatus('signing')
      const result = await signAndExecute(tx)
      setTxDigest(result.digest)

      setStatus('syncing')
      const syncRes = await fetch('/api/souls/publish', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txDigest: result.digest,
          category: params.category,
          tags: params.tags,
          previewImages: params.previewImages,
          readme: params.readme ?? null,
          sealSidecar: params.sealSidecar ?? null,
          skillsSealSidecar: params.skillsSealSidecar ?? null,
        }),
      })
      if (!syncRes.ok) {
        const body = await syncRes.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror publish')
      }

      setStatus('done')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Publish failed')
      setStatus('error')
    }
  }

  return { status, error, txDigest, publish, suiWallet }
}
