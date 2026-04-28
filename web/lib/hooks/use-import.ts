'use client'

import { useEffect, useRef, useState } from 'react'
import type { Transaction } from '@mysten/sui/transactions'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import { buildImportSoulTx } from '@/lib/soulidity/tx/import'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@/lib/soulidity/client-session'
import { normalizeTags } from '@/lib/soulidity/tags'
import type { SoulDownloadPolicy } from '@/lib/soulidity/types'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import {
  extractSoulMintedToKioskEvent,
  tryExtractAssetVersionAppendedEvent,
  tryExtractMemoryEntryAppendedEvent,
  tryExtractSkillVersionAppendedEvent,
} from '@/lib/soulidity/events'
import {
  createAssetSealSidecarFromMaterial,
  createMemorySealSidecarFromMaterial,
  createSkillSealSidecarFromMaterial,
  createSoulSealSidecarFromMaterial,
  type PendingSealMaterial,
} from '@/lib/upload/client-seal'
import type { SealEnvelopeSidecar } from '@/lib/services/seal-crypto'

const IMPORT_RECOVERY_KEY = 'soul-import-recovery'

interface ImportRecoveryState {
  userId: string
  txDigest: string
  syncBody?: ImportSyncBody | null
  pendingSync?: ImportSyncMaterial | null
  deploymentSignature: string
}

export type ImportStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

export interface ImportSyncResponse {
  txDigest: string
  soulOnChainId: string
  provenanceKind: string
  originRef: string
}

interface ImportSyncBody {
  txDigest: string
  tags: string[]
  previewImages: string[]
  readme: string | null
  sealSidecar: SealEnvelopeSidecar | null
  memorySealSidecar: SealEnvelopeSidecar | null
  skillsSealSidecar: SealEnvelopeSidecar | null
  assetsSealSidecar: SealEnvelopeSidecar | null
}

type ImportSyncMaterial = Pick<
  ImportParams,
  | 'tags'
  | 'previewImages'
  | 'readme'
  | 'sealMaterial'
  | 'memorySealMaterial'
  | 'skillsSealMaterial'
  | 'assetsSealMaterial'
>

export interface ImportParams {
  name: string
  description: string
  tags: string[]
  imageUrl: string
  previewImages: string[]
  readme?: string | null
  protectedBlobObjectId: string
  foundingMemoryBlobObjectId?: string | null
  skillsBlobObjectId?: string | null
  initialSkillName?: string | null
  skillsVisibility?: 'public' | 'private'
  initialSprite?: {
    blobObjectId: string
    assetName?: string | null
    versionIndex?: number | null
    visibility?: 'public' | 'private'
    downloadPolicy?: SoulDownloadPolicy | null
    spriteConfigJson: string
    spriteMoodMapJson?: string | null
  } | null
  initialVoice?: {
    blobObjectId: string
    assetName: string
    versionIndex?: number | null
    visibility?: 'public' | 'private'
    downloadPolicy?: SoulDownloadPolicy | null
    voiceConfigJson?: string | null
  } | null
  contentAccessPriceAtomic?: number
  contentAccessDefaultScopeMask?: number
  contentAccessDefaultDurationMs?: number | null
  originRef: string
  creatorRoyaltyBps: number
  sealMaterial?: PendingSealMaterial | null
  memorySealMaterial?: PendingSealMaterial | null
  skillsSealMaterial?: PendingSealMaterial | null
  assetsSealMaterial?: PendingSealMaterial | null
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

function isImportSyncBody(value: unknown): value is ImportSyncBody {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ImportSyncBody>
  return typeof candidate.txDigest === 'string'
    && Array.isArray(candidate.tags)
    && Array.isArray(candidate.previewImages)
    && (candidate.readme === null || typeof candidate.readme === 'string')
    && (candidate.sealSidecar === null || typeof candidate.sealSidecar === 'object')
    && (candidate.memorySealSidecar === null || typeof candidate.memorySealSidecar === 'object')
    && (candidate.skillsSealSidecar === null || typeof candidate.skillsSealSidecar === 'object')
    && (candidate.assetsSealSidecar === null || typeof candidate.assetsSealSidecar === 'object')
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

function isImportSyncMaterial(value: unknown): value is ImportSyncMaterial {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ImportSyncMaterial>
  return Array.isArray(candidate.tags)
    && candidate.tags.every((tag) => typeof tag === 'string')
    && Array.isArray(candidate.previewImages)
    && candidate.previewImages.every((image) => typeof image === 'string')
    && (candidate.readme == null || typeof candidate.readme === 'string')
    && isOptionalPendingSealMaterial(candidate.sealMaterial)
    && isOptionalPendingSealMaterial(candidate.memorySealMaterial)
    && isOptionalPendingSealMaterial(candidate.skillsSealMaterial)
    && isOptionalPendingSealMaterial(candidate.assetsSealMaterial)
}

function buildImportSyncMaterial(params: ImportParams): ImportSyncMaterial {
  return {
    tags: params.tags,
    previewImages: params.previewImages,
    readme: params.readme ?? null,
    sealMaterial: params.sealMaterial ?? null,
    memorySealMaterial: params.memorySealMaterial ?? null,
    skillsSealMaterial: params.skillsSealMaterial ?? null,
    assetsSealMaterial: params.assetsSealMaterial ?? null,
  }
}

function persistImportRecovery(recovery: ImportRecoveryState | null) {
  if (typeof window === 'undefined') return
  try {
    if (recovery) {
      sessionStorage.setItem(IMPORT_RECOVERY_KEY, JSON.stringify(recovery))
    } else {
      sessionStorage.removeItem(IMPORT_RECOVERY_KEY)
    }
  } catch {}
}

async function buildImportSyncBody(params: {
  txDigest: string
  txResult: unknown
  importParams: ImportSyncMaterial
  suiClient: unknown
}): Promise<ImportSyncBody> {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const minted = extractSoulMintedToKioskEvent(params.txResult as never, packageId)
  const foundingMemory = tryExtractMemoryEntryAppendedEvent(params.txResult as never, packageId)
  const initialSkill = tryExtractSkillVersionAppendedEvent(params.txResult as never, packageId)
  const initialAsset = tryExtractAssetVersionAppendedEvent(params.txResult as never, packageId)

  return {
    txDigest: params.txDigest,
    tags: normalizeTags(params.importParams.tags),
    previewImages: params.importParams.previewImages,
    readme: params.importParams.readme ?? null,
    sealSidecar: params.importParams.sealMaterial
      ? await createSoulSealSidecarFromMaterial({
          suiClient: params.suiClient as never,
          packageId,
          soulObjectId: minted.soulId,
          material: params.importParams.sealMaterial,
        })
      : null,
    memorySealSidecar: params.importParams.memorySealMaterial && foundingMemory
      ? await createMemorySealSidecarFromMaterial({
          suiClient: params.suiClient as never,
          packageId,
          memoryObjectId: foundingMemory.memoryId,
          timestampKey: foundingMemory.timestampKey,
          material: params.importParams.memorySealMaterial,
        })
      : null,
    skillsSealSidecar: params.importParams.skillsSealMaterial && initialSkill
      ? await createSkillSealSidecarFromMaterial({
          suiClient: params.suiClient as never,
          packageId,
          skillsObjectId: initialSkill.skillsId,
          skillName: initialSkill.skillName,
          versionIndex: initialSkill.versionIndex,
          material: params.importParams.skillsSealMaterial,
        })
      : null,
    assetsSealSidecar: params.importParams.assetsSealMaterial && initialAsset
      ? await createAssetSealSidecarFromMaterial({
          suiClient: params.suiClient as never,
          packageId,
          assetsObjectId: initialAsset.assetsId,
          assetName: initialAsset.assetName,
          versionIndex: initialAsset.versionIndex,
          material: params.importParams.assetsSealMaterial,
        })
      : null,
  }
}

export function useImport() {
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const [importData, setImportData] = useState<ImportSyncResponse | null>(null)
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
  const { getAuthHeaders, user } = useAuth()
  const recoveryRef = useRef<ImportRecoveryState | null>(null)

  // Hydrate pending recovery state from sessionStorage
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      try {
        const raw = sessionStorage.getItem(IMPORT_RECOVERY_KEY)
        if (raw) {
          const recovery: ImportRecoveryState = JSON.parse(raw)
          const hasRecoverablePayload = isImportSyncBody(recovery.syncBody) || isImportSyncMaterial(recovery.pendingSync)
          if (recovery.txDigest && hasRecoverablePayload && recovery.userId === user?.id && hasCurrentSoulidityDeploymentSignature(recovery)) {
            recoveryRef.current = recovery
            setTxDigest(recovery.txDigest)
          } else if (user?.id) {
            // Only clear when a different authenticated user is confirmed, not during auth loading
            sessionStorage.removeItem(IMPORT_RECOVERY_KEY)
          }
        }
      } catch { /* ignore */ }
    })
    return () => { cancelled = true }
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
        await assertObjectInputsExist(suiClient, {
          'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
          'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
          'Soul character blob': params.protectedBlobObjectId,
          'Founding memory blob': params.foundingMemoryBlobObjectId ?? null,
          'Skills blob': params.skillsBlobObjectId ?? null,
          'Persona sprite blob': params.initialSprite?.blobObjectId ?? null,
        })
        const tx: Transaction = buildImportSoulTx({
          currentKioskId: personalKiosk?.currentKioskId ?? null,
          currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
          name: params.name,
          description: params.description,
          imageUrl: params.imageUrl,
          protectedBlobObjectId: params.protectedBlobObjectId,
          foundingMemoryBlobObjectId: params.foundingMemoryBlobObjectId ?? null,
          skillsBlobObjectId: params.skillsBlobObjectId ?? null,
          initialSkillName: params.initialSkillName ?? null,
          skillsVisibility: params.skillsVisibility ?? 'private',
          initialSprite: params.initialSprite ?? null,
          initialVoice: params.initialVoice ?? null,
          contentAccessPriceAtomic: params.contentAccessPriceAtomic,
          contentAccessDefaultScopeMask: params.contentAccessDefaultScopeMask,
          contentAccessDefaultDurationMs: params.contentAccessDefaultDurationMs ?? null,
          originRef: params.originRef,
          creatorRoyaltyBps: params.creatorRoyaltyBps,
        })

        setStatus('signing')
        const result = await signAndExecute(tx)
        const executedDigest = result.digest
        digest = executedDigest
        setTxDigest(executedDigest)

        // Persist raw Seal material before calling Seal key servers. If sidecar
        // creation fails, refresh can rebuild the sidecars without re-importing.
        const pendingSync = buildImportSyncMaterial(params)
        const recovery: ImportRecoveryState = attachSoulidityDeploymentSignature({
          userId: user?.id ?? '',
          txDigest: executedDigest,
          pendingSync,
          syncBody: null,
        })
        recoveryRef.current = recovery
        persistImportRecovery(recovery)

        const syncBody = await buildImportSyncBody({
          txDigest: executedDigest,
          txResult: result,
          importParams: pendingSync,
          suiClient,
        })
        recovery.syncBody = syncBody
        recoveryRef.current = recovery
        persistImportRecovery(recovery)
      }

      // Use recovered sync body when available
      if (!digest) {
        throw new Error('Import transaction digest is missing')
      }
      const recovery = recoveryRef.current?.txDigest === digest ? recoveryRef.current : null
      let syncBody = recovery?.syncBody ?? null
      if (!syncBody) {
        const pendingSync = recovery?.pendingSync ?? buildImportSyncMaterial(params)
        syncBody = await buildImportSyncBody({
          txDigest: digest,
          txResult: await suiClient.getTransactionBlock({
            digest,
            options: { showEvents: true, showObjectChanges: true, showEffects: true, showInput: true },
          }),
          importParams: pendingSync,
          suiClient,
        })
        if (recovery) {
          recovery.syncBody = syncBody
          recoveryRef.current = recovery
          persistImportRecovery(recovery)
        }
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
      persistImportRecovery(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Import failed')
      setStatus('error')
    }
  }

  return { status, error, txDigest, importData, importSoul, suiWallet }
}
