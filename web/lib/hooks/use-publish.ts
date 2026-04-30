'use client'

import { useEffect, useRef, useState } from 'react'
import posthog from 'posthog-js'
import type { Transaction } from '@mysten/sui/transactions'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import { buildPublishSoulTx } from '@/lib/soulidity/tx/publish'
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
import {
  assertSuiTxSucceeded,
  getSuiTxErrorProperties,
} from '@/lib/sui/tx-result'

const MINT_RECOVERY_KEY = 'soul-mint-recovery'

interface MintRecoveryState {
  userId: string
  txDigest: string
  syncBody?: PublishSyncBody | null
  pendingSync?: PublishSyncMaterial | null
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

interface PublishSyncBody {
  txDigest: string
  tags: string[]
  previewImages: string[]
  readme: string | null
  sealSidecar: SealEnvelopeSidecar | null
  memorySealSidecar: SealEnvelopeSidecar | null
  skillsSealSidecar: SealEnvelopeSidecar | null
  assetsSealSidecar: SealEnvelopeSidecar | null
}

type PublishSyncMaterial = Pick<
  PublishParams,
  | 'tags'
  | 'previewImages'
  | 'readme'
  | 'sealMaterial'
  | 'memorySealMaterial'
  | 'skillsSealMaterial'
  | 'assetsSealMaterial'
>

export interface PublishParams {
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
  skillsSealMaterial?: PendingSealMaterial | null
  memorySealMaterial?: PendingSealMaterial | null
  assetsSealMaterial?: PendingSealMaterial | null
  creatorRoyaltyBps: number
  sealMaterial?: PendingSealMaterial | null
  /**
   * Splices N `certify_blob` calls into the mint PTB before `mint_native_in_personal_kiosk`.
   * Provided by `prepareSoulBlobsForBatchPublish`; lets register/certify+mint cost 2 signatures total.
   */
  attachBeforeMint?: (tx: Transaction) => void | Promise<void>
  /**
   * Invoked once `signAndExecute(mintTx)` succeeds. Used by callers to drop
   * batch register-recovery state so the next deploy does not surface a now
   * stale orphan record. No-op if the mint TX never executes.
   */
  onMintTxExecuted?: () => void
  /**
   * Personal kiosk pre-resolved by the caller's preflight. When set, the hook
   * skips the in-line `/api/souls/personal-kiosk` fetch so a transient 5xx
   * cannot strand a freshly-paid batch register PTB. The caller is expected to
   * have already confirmed the kiosk objects exist on-chain via
   * `assertObjectInputsExist`.
   */
  prefetchedPersonalKiosk?: { currentKioskId: string | null; currentKioskCapOnChainId: string | null } | null
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

function isPublishSyncBody(value: unknown): value is PublishSyncBody {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PublishSyncBody>
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

function isPublishSyncMaterial(value: unknown): value is PublishSyncMaterial {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PublishSyncMaterial>
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

function buildPublishSyncMaterial(params: PublishParams): PublishSyncMaterial {
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

function persistMintRecovery(recovery: MintRecoveryState | null) {
  if (typeof window === 'undefined') return
  try {
    if (recovery) {
      sessionStorage.setItem(MINT_RECOVERY_KEY, JSON.stringify(recovery))
    } else {
      sessionStorage.removeItem(MINT_RECOVERY_KEY)
    }
  } catch {}
}

async function buildPublishSyncBody(params: {
  txDigest: string
  txResult: unknown
  publishParams: PublishSyncMaterial
  suiClient: unknown
}): Promise<PublishSyncBody> {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const minted = extractSoulMintedToKioskEvent(params.txResult as never, packageId)
  const foundingMemory = tryExtractMemoryEntryAppendedEvent(params.txResult as never, packageId)
  const initialSkill = tryExtractSkillVersionAppendedEvent(params.txResult as never, packageId)
  const initialAsset = tryExtractAssetVersionAppendedEvent(params.txResult as never, packageId)

  const sealSidecar = params.publishParams.sealMaterial
    ? await createSoulSealSidecarFromMaterial({
        suiClient: params.suiClient as never,
        packageId,
        soulObjectId: minted.soulId,
        material: params.publishParams.sealMaterial,
      })
    : null
  const memorySealSidecar = params.publishParams.memorySealMaterial && foundingMemory
    ? await createMemorySealSidecarFromMaterial({
        suiClient: params.suiClient as never,
        packageId,
        memoryObjectId: foundingMemory.memoryId,
        timestampKey: foundingMemory.timestampKey,
        material: params.publishParams.memorySealMaterial,
      })
    : null
  const skillsSealSidecar = params.publishParams.skillsSealMaterial && initialSkill
    ? await createSkillSealSidecarFromMaterial({
        suiClient: params.suiClient as never,
        packageId,
        skillsObjectId: initialSkill.skillsId,
        skillName: initialSkill.skillName,
        versionIndex: initialSkill.versionIndex,
        material: params.publishParams.skillsSealMaterial,
      })
    : null
  const assetsSealSidecar = params.publishParams.assetsSealMaterial && initialAsset
    ? await createAssetSealSidecarFromMaterial({
        suiClient: params.suiClient as never,
        packageId,
        assetsObjectId: initialAsset.assetsId,
        assetName: initialAsset.assetName,
        versionIndex: initialAsset.versionIndex,
        material: params.publishParams.assetsSealMaterial,
      })
    : null

  return {
    txDigest: params.txDigest,
    tags: normalizeTags(params.publishParams.tags),
    previewImages: params.publishParams.previewImages,
    readme: params.publishParams.readme ?? null,
    sealSidecar,
    memorySealSidecar,
    skillsSealSidecar,
    assetsSealSidecar,
  }
}

export function usePublish() {
  const [status, setStatus] = useState<PublishStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const [publishData, setPublishData] = useState<PublishSyncResponse | null>(null)
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
  const { getAuthHeaders, user } = useAuth()
  const recoveryRef = useRef<MintRecoveryState | null>(null)

  // Hydrate pending mint recovery state from sessionStorage (survives page refresh)
  // Scoped to authenticated user — discard cross-user stale state
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      try {
        const raw = sessionStorage.getItem(MINT_RECOVERY_KEY)
        if (raw) {
          const recovery: MintRecoveryState = JSON.parse(raw)
          const hasRecoverablePayload = isPublishSyncBody(recovery.syncBody) || isPublishSyncMaterial(recovery.pendingSync)
          if (recovery.txDigest && hasRecoverablePayload && recovery.userId === user?.id && hasCurrentSoulidityDeploymentSignature(recovery)) {
            recoveryRef.current = recovery
            setTxDigest(recovery.txDigest)
          } else {
            sessionStorage.removeItem(MINT_RECOVERY_KEY)
          }
        }
      } catch { /* ignore corrupt/missing storage */ }
    })
    return () => { cancelled = true }
  }, [user?.id])

  async function publish(params: PublishParams) {
    if (!suiWallet) {
      setError('Please sign in first')
      setStatus('error')
      return
    }

    const startedAt = Date.now()
    posthog.capture('soul_publish_started', { resumed: Boolean(txDigest) })
    try {
      setError(null)
      const authHeaders = await getAuthHeaders()

      // Resume sync for an already-executed mint TX (e.g. after a transient sync failure or page refresh)
      let digest = txDigest
      if (!digest) {
        setStatus('building')
        // Reuse the caller's preflight kiosk when supplied; this is the
        // contract for batch publishes that pay PTB1 before reaching the hook
        // and would orphan the registered Blob objects on a fresh-fetch 5xx.
        // `null` is a legitimate preflight result (first-time creator: 404 →
        // no kiosk yet), so we must NOT fall back on it — only `undefined`
        // (no preflight supplied) triggers the resolvePersonalKiosk fetch.
        const personalKiosk = Object.prototype.hasOwnProperty.call(params, 'prefetchedPersonalKiosk')
          ? params.prefetchedPersonalKiosk
          : await resolvePersonalKiosk(authHeaders, suiWallet.address)
        await assertObjectInputsExist(suiClient, {
          'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
          'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
          'Soul character blob': params.protectedBlobObjectId,
          'Founding memory blob': params.foundingMemoryBlobObjectId ?? null,
          'Skills blob': params.skillsBlobObjectId ?? null,
          'Persona sprite blob': params.initialSprite?.blobObjectId ?? null,
        })
        const tx: Transaction = await buildPublishSoulTx({
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
          creatorRoyaltyBps: params.creatorRoyaltyBps,
          attachBeforeMint: params.attachBeforeMint,
        })

        setStatus('signing')
        const result = await signAndExecute(tx)
        const executedDigest = result.digest
        assertSuiTxSucceeded(result, 'Soul mint transaction')
        digest = executedDigest
        setTxDigest(executedDigest)
        // Persist raw Seal material BEFORE clearing batch recovery so a tab
        // crash / refresh / OS kill in the window between "mint succeeded"
        // and "mint recovery written" cannot strand the user with a minted
        // Soul that has no resumable mirror state on either side. Sidecar
        // creation can still fail later — refresh rebuilds them from
        // pendingSync without re-minting.
        const pendingSync = buildPublishSyncMaterial(params)
        const recovery: MintRecoveryState = attachSoulidityDeploymentSignature({
          userId: user?.id ?? '',
          txDigest: executedDigest,
          pendingSync,
          syncBody: null,
        })
        recoveryRef.current = recovery
        persistMintRecovery(recovery)

        // Mint TX is on-chain AND succeeded AND the resumable mirror state is
        // durable — the registered Blob objects from PTB1 are now certified,
        // so the batch register-recovery record is no longer needed.
        try { params.onMintTxExecuted?.() } catch { /* swallow callback errors */ }
        posthog.capture('soul_publish_sui_signed', {
          txDigest: executedDigest,
          elapsedMs: Date.now() - startedAt,
        })

        const syncBody = await buildPublishSyncBody({
          txDigest: executedDigest,
          txResult: result,
          publishParams: pendingSync,
          suiClient,
        })
        const recoveryWithSyncBody = { ...recovery, syncBody }
        recoveryRef.current = recoveryWithSyncBody
        persistMintRecovery(recoveryWithSyncBody)
      }

      // Use recovered sync body when available (preserves original metadata after refresh),
      // otherwise build from caller params (same-tab retry with in-memory txDigest)
      if (!digest) {
        throw new Error('Publish transaction digest is missing')
      }
      const recovery = recoveryRef.current?.txDigest === digest ? recoveryRef.current : null
      let syncBody = recovery?.syncBody ?? null
      if (!syncBody) {
        const pendingSync = recovery?.pendingSync ?? buildPublishSyncMaterial(params)
        syncBody = await buildPublishSyncBody({
          txDigest: digest,
          txResult: await suiClient.getTransactionBlock({
            digest,
            options: { showEvents: true, showObjectChanges: true, showEffects: true, showInput: true },
          }),
          publishParams: pendingSync,
          suiClient,
        })
        if (recovery) {
          const recoveryWithSyncBody = { ...recovery, syncBody }
          recoveryRef.current = recoveryWithSyncBody
          persistMintRecovery(recoveryWithSyncBody)
        }
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
      posthog.capture('soul_publish_completed', {
        txDigest: digest,
        elapsedMs: Date.now() - startedAt,
      })

      // Clear recovery state on successful sync
      recoveryRef.current = null
      persistMintRecovery(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Publish failed')
      setStatus('error')
      posthog.captureException(
        nextError instanceof Error ? nextError : new Error(String(nextError)),
        {
          scope: 'soul_publish',
          phase: status,
          txDigest,
          ...getSuiTxErrorProperties(nextError),
          elapsedMs: Date.now() - startedAt,
        },
      )
    }
  }

  return { status, error, txDigest, publishData, publish, suiWallet }
}
