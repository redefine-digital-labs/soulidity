'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import {
  buildPersonaSpriteMoodMap,
  validatePersonaSpriteDraft,
  type PersonaSpriteVisibility,
} from '@/lib/soulidity/persona-sprite'
import { buildPersonalJoinSoulTx } from '@/lib/soulidity/tx/personal-join'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
import { useAuth } from '@/components/providers/auth-provider'
import { uploadSoulPayload } from '@/lib/upload/client-upload'
import type { KioskNft } from '@/lib/hooks/use-kiosk-nfts'
import type { WrapPublishResult } from '@/components/providers/wrap-provider'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@/lib/soulidity/client-session'

const WRAP_MINT_RECOVERY_KEY = 'soul-wrap-personal-recovery'

interface WrapSyncBody {
  txDigest: string
  sealSidecar: string | null
  memorySealSidecar: string | null
  skillsSealSidecar: string | null
  assetsSealSidecar: string | null
}

interface WrapRecoveryState {
  userId: string
  txDigest: string
  syncBody: WrapSyncBody
  deploymentSignature: string
}

export type WrapPublishStatus = 'idle' | 'uploading' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

export interface WrapPublishParams {
  nft: KioskNft
  charFile: File
  memoryFile: File
  skillsFile?: File | null
  spriteSheetFile?: File | null
  spriteConfigFile?: File | null
  spriteVisibility?: PersonaSpriteVisibility
  royalty: number
}

function isWrapSyncBody(value: unknown): value is WrapSyncBody {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WrapSyncBody>
  return typeof candidate.txDigest === 'string'
    && candidate.txDigest.length > 0
    && (candidate.sealSidecar === null || typeof candidate.sealSidecar === 'string')
    && (candidate.memorySealSidecar === null || typeof candidate.memorySealSidecar === 'string')
    && (candidate.skillsSealSidecar === null || typeof candidate.skillsSealSidecar === 'string')
    && (candidate.assetsSealSidecar === null || typeof candidate.assetsSealSidecar === 'string')
}

export function sanitizeWrapRecoveryState(raw: string | null, userId: string | null | undefined): WrapRecoveryState | null {
  if (!raw || !userId) return null

  try {
    const parsed = JSON.parse(raw) as Partial<WrapRecoveryState>
    if (
      parsed.userId !== userId
      || typeof parsed.txDigest !== 'string'
      || !isWrapSyncBody(parsed.syncBody)
      || !hasCurrentSoulidityDeploymentSignature(parsed)
    ) {
      return null
    }
    if (parsed.syncBody.txDigest !== parsed.txDigest) {
      return null
    }
    return {
      userId,
      txDigest: parsed.txDigest,
      syncBody: parsed.syncBody,
      deploymentSignature: parsed.deploymentSignature,
    }
  } catch {
    return null
  }
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

const MIME_MAP: Record<string, string> = {
  '.md': 'text/markdown', '.txt': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
  '.json': 'application/json', '.zip': 'application/zip',
}

/** Re-wrap a File with correct MIME type based on extension (browsers often misdetect .md) */
function withMime(file: File): File {
  const ext = file.name.includes('.') ? '.' + file.name.split('.').pop()!.toLowerCase() : ''
  const expected = MIME_MAP[ext]
  if (!expected || file.type === expected) return file
  return new File([file], file.name, { type: expected })
}

async function uploadFile(
  file: File,
  type: 'public' | 'encrypted',
  headers: Record<string, string>,
  sendObjectTo?: string,
) {
  return uploadSoulPayload({
    file: withMime(file),
    uploadType: type,
    kind: 'soul-content',
    authHeaders: headers,
    sendObjectTo: sendObjectTo ?? null,
  })
}

export function useWrapPublish() {
  const [status, setStatus] = useState<WrapPublishStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const [result, setResult] = useState<WrapPublishResult | null>(null)
  const { suiWallet, signAndExecute, suiClient } = usePrivySuiSign()
  const { getAuthHeaders, user } = useAuth()
  const recoveryRef = useRef<WrapRecoveryState | null>(null)

  useEffect(() => {
    const recovery = sanitizeWrapRecoveryState(
      typeof window === 'undefined' ? null : sessionStorage.getItem(WRAP_MINT_RECOVERY_KEY),
      user?.id,
    )
    if (recovery) {
      recoveryRef.current = recovery
      setTxDigest(recovery.txDigest)
      return
    }

    recoveryRef.current = null
    setTxDigest(null)
    try {
      sessionStorage.removeItem(WRAP_MINT_RECOVERY_KEY)
    } catch {}
  }, [user?.id])

  const clearRecovery = useCallback(() => {
    recoveryRef.current = null
    setTxDigest(null)
    try {
      sessionStorage.removeItem(WRAP_MINT_RECOVERY_KEY)
    } catch {}
  }, [])

  const publish = useCallback(async (params?: WrapPublishParams) => {
    if (!suiWallet) {
      setError('Please sign in first')
      setStatus('error')
      return null
    }

    try {
      setError(null)
      const authHeaders = await getAuthHeaders()
      let digest = txDigest

      if (!digest) {
        if (!params) {
          throw new Error('Wrap draft is missing. Please restart the flow before signing.')
        }

        setResult(null)
        setStatus('uploading')
        const walletAddress = suiWallet.address

        // 1. Upload character file (encrypted)
        const charUpload = await uploadFile(params.charFile, 'encrypted', authHeaders, walletAddress)
        if (!charUpload.blobObjectId) {
          throw new Error('Character file was deduplicated. Please modify the content to make it unique.')
        }

        // 2. Upload memory file (encrypted)
        const memUpload = await uploadFile(params.memoryFile, 'encrypted', authHeaders, walletAddress)
        if (!memUpload.blobObjectId) {
          throw new Error('Memory file was deduplicated. Please modify the content to make it unique.')
        }
        if (typeof memUpload.sealDekEnvelope !== 'string' || !memUpload.sealDekEnvelope.trim()) {
          throw new Error('Memory file upload is missing Seal recovery data.')
        }

        // 3. Upload skills file (encrypted, optional)
        let skillsUpload = null
        if (params.skillsFile) {
          skillsUpload = await uploadFile(params.skillsFile, 'encrypted', authHeaders, walletAddress)
        }

        let spriteUpload = null
        const spriteValidation = await validatePersonaSpriteDraft({
          sheetFile: params.spriteSheetFile ?? null,
          configFile: params.spriteConfigFile ?? null,
        })
        if (!spriteValidation.ok) {
          throw new Error(spriteValidation.error)
        }

        if (params.spriteSheetFile && spriteValidation.config) {
          const visibility = params.spriteVisibility ?? 'private'
          spriteUpload = await uploadFile(
            params.spriteSheetFile,
            visibility === 'public' ? 'public' : 'encrypted',
            authHeaders,
            walletAddress,
          )
          if (!spriteUpload.blobObjectId) {
            throw new Error('Persona sprite upload is missing blobObjectId.')
          }
          if (visibility === 'private' && (!spriteUpload.sealDekEnvelope || typeof spriteUpload.sealDekEnvelope !== 'string')) {
            throw new Error('Persona sprite upload is missing Seal recovery data.')
          }

        }

        // 4. Resolve kiosk + build TX
        setStatus('building')
        const personalKiosk = await resolvePersonalKiosk(authHeaders, walletAddress)
        await assertObjectInputsExist(suiClient, {
          'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
          'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
          'Wrapped soul character blob': charUpload.blobObjectId,
          'Wrapped founding memory blob': memUpload.blobObjectId,
          'Wrapped skills blob': skillsUpload?.blobObjectId ?? null,
          'Wrapped persona sprite blob': spriteUpload?.blobObjectId ?? null,
          'Source NFT': params.nft.objectId,
        })

        const tx = buildPersonalJoinSoulTx({
          currentKioskId: personalKiosk?.currentKioskId ?? null,
          currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
          sourceObjectId: params.nft.objectId,
          sourceObjectType: params.nft.objectType,
          name: params.nft.name,
          description: params.nft.description || '',
          imageUrl: params.nft.imageUrl || '',
          protectedBlobObjectId: charUpload.blobObjectId,
          foundingMemoryBlobObjectId: memUpload.blobObjectId,
          skillsBlobObjectId: skillsUpload?.blobObjectId ?? null,
          initialSkillName: skillsUpload?.skillName ?? null,
          initialSprite: spriteUpload && spriteValidation.config
            ? {
                blobObjectId: spriteUpload.blobObjectId,
                assetName: 'persona-sprite',
                visibility: params.spriteVisibility ?? 'private',
                downloadPolicy: (params.spriteVisibility ?? 'private') === 'public' ? 'public' : 'owner_only',
                spriteConfigJson: JSON.stringify({
                  frameWidth: spriteValidation.config.frameWidth,
                  frameHeight: spriteValidation.config.frameHeight,
                  columns: spriteValidation.config.columns,
                  animations: spriteValidation.config.animations,
                }),
                spriteMoodMapJson: JSON.stringify(buildPersonaSpriteMoodMap(spriteValidation.config.animations)),
              }
            : null,
          originRef: `sui:${params.nft.objectId}`,
          creatorRoyaltyBps: params.royalty,
        })

        // 5. Sign & execute
        setStatus('signing')
        const txResult = await signAndExecute(tx)
        const executedDigest = txResult.digest
        digest = executedDigest
        setTxDigest(executedDigest)

        const recovery: WrapRecoveryState = {
          ...attachSoulidityDeploymentSignature({
            userId: user?.id ?? '',
            txDigest: executedDigest,
            syncBody: {
              txDigest: executedDigest,
              sealSidecar: typeof charUpload.sealDekEnvelope === 'string' ? charUpload.sealDekEnvelope : null,
              memorySealSidecar: typeof memUpload.sealDekEnvelope === 'string' ? memUpload.sealDekEnvelope : null,
              skillsSealSidecar: typeof skillsUpload?.sealDekEnvelope === 'string' ? skillsUpload.sealDekEnvelope : null,
              assetsSealSidecar: typeof spriteUpload?.sealDekEnvelope === 'string' ? spriteUpload.sealDekEnvelope : null,
            },
          }),
        }
        recoveryRef.current = recovery
        try {
          sessionStorage.setItem(WRAP_MINT_RECOVERY_KEY, JSON.stringify(recovery))
        } catch {}
      }

      const syncBody = recoveryRef.current?.txDigest === digest ? recoveryRef.current.syncBody : null
      if (!syncBody) {
        throw new Error('Pending wrap recovery data is unavailable. Do not retry this wrap transaction.')
      }

      setStatus('syncing')
      const syncRes = await fetch('/api/wrap-link/personal', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(syncBody),
      })
      if (!syncRes.ok) {
        const body = await syncRes.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to sync wrap transaction')
      }

      const syncData: WrapPublishResult = await syncRes.json()
      setResult(syncData)
      setStatus('done')
      clearRecovery()
      return syncData
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wrap failed')
      setStatus('error')
      return null
    }
  }, [suiWallet, txDigest, signAndExecute, getAuthHeaders, user?.id, clearRecovery, suiClient])

  return { status, error, txDigest, result, publish, suiWallet }
}
