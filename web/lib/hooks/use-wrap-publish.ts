'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { assertObjectInputsExist } from '@soulidity/sdk'
import { buildPersonalJoinSoulTx } from '@soulidity/sdk'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'
import {
  prepareSoulBlobsForBatchPublish,
  type BatchSoulUploadFile,
  type PreparedSoulBlobs,
} from '@/lib/upload/client-upload'
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
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
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
    sealPackageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID'),
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

function buildBatchFingerprint(walletAddress: string, files: BatchSoulUploadFile[]): string {
  return JSON.stringify({
    walletAddress: walletAddress.toLowerCase(),
    files: files.map((f) => ({
      name: f.file.name,
      size: f.file.size,
      lastModified: f.file.lastModified,
      type: f.file.type,
      uploadType: f.uploadType,
      kind: f.kind,
      sendObjectTo: f.sendObjectTo?.trim().toLowerCase() ?? null,
    })),
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
  const preparedBatchRef = useRef<{
    walletAddress: string
    fingerprint: string
    prepared: PreparedSoulBlobs
  } | null>(null)

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

        const fileIndex = { char: -1, memory: -1, skills: -1 }
        const batchFiles: BatchSoulUploadFile[] = []

        fileIndex.char = batchFiles.length
        batchFiles.push({
          file: withMime(params.charFile),
          uploadType: 'encrypted',
          kind: 'soul-content',
          sendObjectTo: walletAddress,
        })

        fileIndex.memory = batchFiles.length
        batchFiles.push({
          file: withMime(params.memoryFile),
          uploadType: 'encrypted',
          kind: 'soul-content',
          sendObjectTo: walletAddress,
        })

        if (params.skillsFile) {
          fileIndex.skills = batchFiles.length
          batchFiles.push({
            file: withMime(params.skillsFile),
            uploadType: 'encrypted',
            kind: 'soul-content',
            sendObjectTo: walletAddress,
            // Skills bundle requires SKILL.md frontmatter parsing; other batch
            // entries (char file, memory file) do not.
            extractSkillMetadata: true,
          })
        }

        const personalKiosk = await resolvePersonalKiosk(authHeaders, walletAddress)
        await assertObjectInputsExist(suiClient, {
          'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
          'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
          'Source NFT': params.nft.objectId,
        })

        const fingerprint = buildBatchFingerprint(walletAddress, batchFiles)
        const cachedBatch = preparedBatchRef.current
        const reusable =
          !!cachedBatch
          && cachedBatch.walletAddress === walletAddress
          && cachedBatch.fingerprint === fingerprint

        let prepared: PreparedSoulBlobs
        if (reusable) {
          prepared = cachedBatch.prepared
        } else {
          if (cachedBatch) preparedBatchRef.current = null
          prepared = await prepareSoulBlobsForBatchPublish({
            files: batchFiles,
            walletAddress,
            suiClient,
            signAndExecute,
            authHeaders,
            confirmQuote: requestUploadCostApproval,
          })
          preparedBatchRef.current = { walletAddress, fingerprint, prepared }
        }

        const charUpload = prepared.files[fileIndex.char]
        const memUpload = prepared.files[fileIndex.memory]
        const skillsUpload = fileIndex.skills >= 0 ? prepared.files[fileIndex.skills] : null

        if (!charUpload.blobObjectId) {
          throw new Error('Character file was deduplicated. Please modify the content to make it unique.')
        }
        if (!memUpload.blobObjectId) {
          throw new Error('Memory file was deduplicated. Please modify the content to make it unique.')
        }
        if (skillsUpload && !skillsUpload.blobObjectId) {
          throw new Error('Skills file was deduplicated. Please modify the content to make it unique.')
        }
        if (!charUpload.sealMaterial) {
          throw new Error('Character file upload is missing Seal recovery data.')
        }
        if (!memUpload.sealMaterial) {
          throw new Error('Memory file upload is missing Seal recovery data.')
        }
        if (skillsUpload && !skillsUpload.sealMaterial) {
          throw new Error('Skills file upload is missing Seal recovery data.')
        }

        setStatus('building')
        await assertObjectInputsExist(suiClient, {
          'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
          'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
          'Wrapped soul character blob': charUpload.blobObjectId,
          'Wrapped founding memory blob': memUpload.blobObjectId,
          'Wrapped skills blob': skillsUpload?.blobObjectId ?? null,
          'Source NFT': params.nft.objectId,
        })

        const tx = await buildPersonalJoinSoulTx({
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
          attachBeforeMint: prepared.attachCertifyCalls,
        })

        setStatus('signing')
        const txResult = await signAndExecute(tx)
        const executedDigest = txResult.digest
        assertSoulidityTxSucceeded(txResult, 'Soul personal join transaction')
        prepared.clearBatchRecovery()
        preparedBatchRef.current = null
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
