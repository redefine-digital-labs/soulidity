'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { assertObjectInputsExist } from '@soulidity/sdk'
import { buildPersonalJoinSoulTx } from '@soulidity/sdk'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'
import { uploadSoulPayload } from '@/lib/upload/client-upload'
import { type PendingSealMaterial } from '@/lib/upload/client-seal'
import { useUploadCostReview } from '@/components/upload/upload-cost-review'
import type { KioskNft } from '@/lib/hooks/use-kiosk-nfts'
import type { WrapPublishResult } from '@/components/providers/wrap-provider'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@soulidity/sdk'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import { extractAllContentVersionAppendedEvents } from '@soulidity/sdk'
import { assertSoulidityTxSucceeded } from '@soulidity/sdk'
import {
  buildLegacyInitialContent,
  buildLegacyInitialStateConfig,
} from '@soulidity/sdk'
import {
  buildContentSidecarsForVersionsWithSuiClient,
  buildPendingMintSlots,
  type ContentSidecarRequestEntry,
} from '@/lib/hooks/phase2-mint-helpers'

const WRAP_MINT_RECOVERY_KEY = 'soul-wrap-personal-recovery'

interface WrapSyncBody {
  txDigest: string
  contentSidecars: ContentSidecarRequestEntry[]
}

interface WrapRecoveryState {
  userId: string
  txDigest: string
  syncBody?: WrapSyncBody | null
  pendingSync?: WrapSyncMaterial | null
  deploymentSignature: string
}

interface WrapSyncMaterial {
  sealMaterial?: PendingSealMaterial | null
  memorySealMaterial?: PendingSealMaterial | null
  skillsSealMaterial?: PendingSealMaterial | null
  skillsName?: string | null
}

export type WrapPublishStatus = 'idle' | 'uploading' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

export interface WrapPublishParams {
  nft: KioskNft
  charFile: File
  memoryFile: File
  skillsFile?: File | null
  royalty: number
}

function isWrapSyncBody(value: unknown): value is WrapSyncBody {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WrapSyncBody>
  return typeof candidate.txDigest === 'string'
    && candidate.txDigest.length > 0
    && Array.isArray(candidate.contentSidecars)
}

function isPendingSealMaterial(value: unknown): value is PendingSealMaterial {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PendingSealMaterial>
  return candidate.version === 1
    && typeof candidate.dek === 'string'
    && typeof candidate.iv === 'string'
    && typeof candidate.contentHash === 'string'
    && typeof candidate.mimeType === 'string'
    && typeof candidate.fileName === 'string'
}

function isOptionalPendingSealMaterial(value: unknown): value is PendingSealMaterial | null | undefined {
  return value == null || isPendingSealMaterial(value)
}

function isWrapSyncMaterial(value: unknown): value is WrapSyncMaterial {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WrapSyncMaterial>
  return isOptionalPendingSealMaterial(candidate.sealMaterial)
    && isOptionalPendingSealMaterial(candidate.memorySealMaterial)
    && isOptionalPendingSealMaterial(candidate.skillsSealMaterial)
}

export function sanitizeWrapRecoveryState(raw: string | null, userId: string | null | undefined): WrapRecoveryState | null {
  if (!raw || !userId) return null

  try {
    const parsed = JSON.parse(raw) as Partial<WrapRecoveryState>
    const hasRecoverablePayload = isWrapSyncBody(parsed.syncBody) || isWrapSyncMaterial(parsed.pendingSync)
    if (
      parsed.userId !== userId
      || typeof parsed.txDigest !== 'string'
      || !hasRecoverablePayload
      || !hasCurrentSoulidityDeploymentSignature(parsed)
    ) {
      return null
    }
    if (parsed.syncBody && parsed.syncBody.txDigest !== parsed.txDigest) {
      return null
    }
    return {
      userId,
      txDigest: parsed.txDigest,
      syncBody: isWrapSyncBody(parsed.syncBody) ? parsed.syncBody : null,
      pendingSync: isWrapSyncMaterial(parsed.pendingSync) ? parsed.pendingSync : null,
      deploymentSignature: parsed.deploymentSignature,
    }
  } catch {
    return null
  }
}

function persistWrapRecovery(recovery: WrapRecoveryState | null) {
  if (typeof window === 'undefined') return
  try {
    if (recovery) {
      sessionStorage.setItem(WRAP_MINT_RECOVERY_KEY, JSON.stringify(recovery))
    } else {
      sessionStorage.removeItem(WRAP_MINT_RECOVERY_KEY)
    }
  } catch {}
}

async function buildWrapSyncBody(params: {
  txDigest: string
  txResult: unknown
  material: WrapSyncMaterial
  suiClient: unknown
}): Promise<WrapSyncBody> {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const versions = extractAllContentVersionAppendedEvents(params.txResult as never, packageId)
  const contentObjectId = versions.length > 0 ? versions[0].contentId : null
  if (!contentObjectId) {
    throw new Error('Wrap-link transaction is missing ContentVersionAppended events')
  }

  const pendingByKindName = buildPendingMintSlots({
    soulMaterial: params.material.sealMaterial ?? null,
    memoryMaterial: params.material.memorySealMaterial ?? null,
    skillsMaterial: params.material.skillsSealMaterial ?? null,
    skillsName: params.material.skillsName,
  })

  const contentSidecars = await buildContentSidecarsForVersionsWithSuiClient({
    suiClient: params.suiClient as never,
    packageId,
    contentObjectId,
    pendingByKindName,
    versions: versions.map((v) => ({
      kind: v.kind,
      name: v.name,
      versionIndex: v.versionIndex,
      sealEncrypted: v.sealEncrypted,
    })),
  })

  return {
    txDigest: params.txDigest,
    contentSidecars,
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
  wallet: {
    walletAddress: string
    suiClient: unknown
    signAndExecute: ReturnType<typeof useWalletSign>['signAndExecute']
    confirmQuote: ReturnType<typeof useUploadCostReview>['requestUploadCostApproval']
  },
  sendObjectTo?: string,
) {
  return uploadSoulPayload({
    file: withMime(file),
    uploadType: type,
    kind: 'soul-content',
    authHeaders: headers,
    sendObjectTo: sendObjectTo ?? null,
    walletAddress: wallet.walletAddress,
    suiClient: wallet.suiClient,
    signAndExecute: wallet.signAndExecute,
    confirmQuote: wallet.confirmQuote,
  })
}

export function useWrapPublish() {
  const [status, setStatus] = useState<WrapPublishStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const [result, setResult] = useState<WrapPublishResult | null>(null)
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
  const { getAuthHeaders, user } = useAuth()
  const { requestUploadCostApproval } = useUploadCostReview()
  const recoveryRef = useRef<WrapRecoveryState | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
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
    })
    return () => { cancelled = true }
  }, [user?.id])

  const clearRecovery = useCallback(() => {
    recoveryRef.current = null
    setTxDigest(null)
    persistWrapRecovery(null)
  }, [])

  const publish = async (params?: WrapPublishParams) => {
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
        const walletUpload = {
          walletAddress,
          suiClient,
          signAndExecute,
          confirmQuote: requestUploadCostApproval,
        }

        // 1. Upload character file (encrypted)
        const charUpload = await uploadFile(params.charFile, 'encrypted', authHeaders, walletUpload, walletAddress)
        if (!charUpload.blobObjectId) {
          throw new Error('Character file was deduplicated. Please modify the content to make it unique.')
        }

        // 2. Upload memory file (encrypted)
        const memUpload = await uploadFile(params.memoryFile, 'encrypted', authHeaders, walletUpload, walletAddress)
        if (!memUpload.blobObjectId) {
          throw new Error('Memory file was deduplicated. Please modify the content to make it unique.')
        }
        if (!memUpload.sealMaterial) {
          throw new Error('Memory file upload is missing Seal recovery data.')
        }

        // 3. Upload skills file (encrypted, optional)
        let skillsUpload = null
        if (params.skillsFile) {
          skillsUpload = await uploadFile(params.skillsFile, 'encrypted', authHeaders, walletUpload, walletAddress)
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
          initialContent: buildLegacyInitialContent({
            protectedBlobObjectId: charUpload.blobObjectId,
            foundingMemoryBlobObjectId: memUpload.blobObjectId,
            skillsBlobObjectId: skillsUpload?.blobObjectId ?? null,
            initialSkillName: skillsUpload?.skillName ?? null,
          }),
          initialStateConfig: buildLegacyInitialStateConfig({
            protectedBlobObjectId: charUpload.blobObjectId,
          }),
          originRef: `sui:${params.nft.objectId}`,
          creatorRoyaltyBps: params.royalty,
        })

        // 5. Sign & execute
        setStatus('signing')
        const txResult = await signAndExecute(tx)
        const executedDigest = txResult.digest
        assertSoulidityTxSucceeded(txResult, 'Soul personal join transaction')
        digest = executedDigest
        setTxDigest(executedDigest)

        const pendingSync: WrapSyncMaterial = {
          sealMaterial: charUpload.sealMaterial ?? null,
          memorySealMaterial: memUpload.sealMaterial ?? null,
          skillsSealMaterial: skillsUpload?.sealMaterial ?? null,
          skillsName: skillsUpload?.skillName ?? null,
        }
        const recovery: WrapRecoveryState = attachSoulidityDeploymentSignature({
          userId: user?.id ?? '',
          txDigest: executedDigest,
          pendingSync,
          syncBody: null,
        })
        recoveryRef.current = recovery
        persistWrapRecovery(recovery)

        const syncBody = await buildWrapSyncBody({
          txDigest: executedDigest,
          txResult,
          material: pendingSync,
          suiClient,
        })
        const recoveryWithSyncBody = { ...recovery, syncBody }
        recoveryRef.current = recoveryWithSyncBody
        persistWrapRecovery(recoveryWithSyncBody)
      }

      if (!digest) {
        throw new Error('Wrap transaction digest is missing')
      }
      const recovery = recoveryRef.current?.txDigest === digest ? recoveryRef.current : null
      let syncBody = recovery?.syncBody ?? null
      if (!syncBody && recovery?.pendingSync) {
        syncBody = await buildWrapSyncBody({
          txDigest: digest,
          txResult: await suiClient.getTransactionBlock({
            digest,
            options: { showEvents: true, showObjectChanges: true, showEffects: true, showInput: true },
          }),
          material: recovery.pendingSync,
          suiClient,
        })
        const recoveryWithSyncBody = { ...recovery, syncBody }
        recoveryRef.current = recoveryWithSyncBody
        persistWrapRecovery(recoveryWithSyncBody)
      }
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
  }

  return { status, error, txDigest, result, publish, suiWallet }
}
