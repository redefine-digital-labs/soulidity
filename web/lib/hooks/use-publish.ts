'use client'

import { useEffect, useRef, useState } from 'react'
import posthog from 'posthog-js'
import type { Transaction } from '@mysten/sui/transactions'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import {
  buildPublishSoulTx,
  buildPublishSoulWithBindTx,
  buildPublishSoulWithListTx,
  buildPublishSoulWithCollectionAndListTx,
} from '@/lib/soulidity/tx/publish'
import { preflightCollectionBindTarget } from '@/lib/soulidity/collection-bind-preflight'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@/lib/soulidity/client-session'
import { normalizeTags } from '@/lib/soulidity/tags'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { extractAllSoulMintedToKioskEvents } from '@/lib/soulidity/events'
import {
  buildLegacyInitialContent,
  buildLegacyInitialStateConfig,
} from '@/lib/soulidity/legacy-mint-bridge'
import { type PendingSealMaterial } from '@/lib/upload/client-seal'
import type { SealEnvelopeSidecar } from '@/lib/services/seal-crypto'
import { assertSoulidityTxSucceeded } from '@/lib/soulidity/market-errors'
import { getSuiTxErrorProperties } from '@/lib/sui/tx-result'
import { assertListingPriceAtomic } from '@/lib/soulidity/listing-price'

// Phase 2: per-version sidecar creation moved into the unified
// `buildSyncSealSidecars` mirror gate. The hook stops constructing
// per-channel sidecars here; the new ContentPanel UI passes
// `contentSidecars: Array<{ kind, name, versionIndex, sidecar }>` directly to
// the sync route. Legacy callers that still expect `{ soul, memory, skill }`
// sidecars receive empty placeholders until they migrate.
const PHASE2_PENDING_SIDECAR: SealEnvelopeSidecar | null = null
function hasValidOptionalLegacyAssetsSealMaterial(_value: unknown): boolean {
  return true
}

const MINT_RECOVERY_KEY = 'soul-mint-recovery'

interface MintRecoveryState {
  userId: string
  txDigest: string
  /** PTB combined mint+bind / mint+list / mint+bind+list — same digest for all mirror calls. */
  publishMode: PublishMode
  collectionBindOnChainId: string | null
  listingPriceAtomic: string | null
  syncBody?: PublishSyncBody | null
  pendingSync?: PublishSyncMaterial | null
  deploymentSignature: string
}

export type PublishStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

export type PublishMode = 'plain' | 'with-bind' | 'with-list' | 'with-bind-and-list'

export interface PublishSyncResponse {
  txDigest: string
  soulOnChainId: string
  stateOnChainId: string
  memoryOnChainId: string
  listingStatus: string
  collectionOnChainId?: string | null
  /** Always equals txDigest now — bind is in the same PTB. */
  collectionAddTxDigest?: string | null
  /** Always equals txDigest now — list is in the same PTB. */
  listingTxDigest?: string | null
  listingObjectOnChainId?: string | null
  listedPriceAtomic?: string | null
}

export interface PublishCollectionBindTarget {
  collectionOnChainId: string
}

interface PublishSyncBody {
  txDigest: string
  soulOnChainId: string
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
  contentAccessPriceAtomic?: number
  contentAccessDefaultScopeMask?: number
  contentAccessDefaultDurationMs?: number | null
  skillsSealMaterial?: PendingSealMaterial | null
  memorySealMaterial?: PendingSealMaterial | null
  creatorRoyaltyBps: number
  sealMaterial?: PendingSealMaterial | null
  attachBeforeMint?: (tx: Transaction) => void | Promise<void>
  onMintTxExecuted?: () => void
  prefetchedPersonalKiosk?: { currentKioskId: string | null; currentKioskCapOnChainId: string | null } | null
  /** Optional existing collection to bind the newly minted Soul into in the SAME PTB as mint. */
  collectionBindTarget?: PublishCollectionBindTarget | null
  /** When true, list the soul at `listingPriceAtomic` in the SAME PTB as mint. */
  listOnPublish: boolean
  /** USDC atomic price string. Required when `listOnPublish` is true. */
  listingPriceAtomic?: string | null
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
    && typeof candidate.soulOnChainId === 'string'
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
    && hasValidOptionalLegacyAssetsSealMaterial(value)
}

function buildPublishSyncMaterial(params: PublishParams): PublishSyncMaterial {
  return {
    tags: params.tags,
    previewImages: params.previewImages,
    readme: params.readme ?? null,
    sealMaterial: params.sealMaterial ?? null,
    memorySealMaterial: params.memorySealMaterial ?? null,
    skillsSealMaterial: params.skillsSealMaterial ?? null,
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

function resolvePublishMode(params: PublishParams): PublishMode {
  const hasBind = !!params.collectionBindTarget?.collectionOnChainId?.trim()
  const wantsListing = params.listOnPublish === true
  if (hasBind && wantsListing) return 'with-bind-and-list'
  if (hasBind) return 'with-bind'
  if (wantsListing) return 'with-list'
  return 'plain'
}

async function buildPublishSyncBody(params: {
  txDigest: string
  txResult: unknown
  soulOnChainId: string | null
  publishParams: PublishSyncMaterial
  suiClient: unknown
}): Promise<PublishSyncBody> {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  // The PTB may bundle multiple events when bind/list are co-signed; pick
  // by route soulId when known (single-soul publish always emits exactly one
  // SoulMintedToKiosk in the new ABI but we still filter for safety).
  const allMinted = extractAllSoulMintedToKioskEvents(params.txResult as never, packageId)
  if (allMinted.length === 0) {
    throw new Error('No SoulMintedToKiosk event in publish transaction')
  }
  const minted = params.soulOnChainId
    ? allMinted.find((e) => e.soulId === params.soulOnChainId) ?? allMinted[0]
    : allMinted[0]
  // Phase 2: per-version sidecars are produced by the unified sync gate, not
  // here. The hook still returns the legacy four-channel shape for now so the
  // sync route signature can stay backwards compatible while the post-tx
  // route is migrated. Each channel resolves to `null` until the new
  // ContentPanel UI feeds in `contentSidecars[]`.
  return {
    txDigest: params.txDigest,
    soulOnChainId: minted.soulId,
    tags: normalizeTags(params.publishParams.tags),
    previewImages: params.publishParams.previewImages,
    readme: params.publishParams.readme ?? null,
    sealSidecar: PHASE2_PENDING_SIDECAR,
    memorySealSidecar: PHASE2_PENDING_SIDECAR,
    skillsSealSidecar: PHASE2_PENDING_SIDECAR,
    assetsSealSidecar: PHASE2_PENDING_SIDECAR,
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
      const publishMode = resolvePublishMode(params)
      const collectionBindOnChainId = params.collectionBindTarget?.collectionOnChainId?.trim() ?? null
      const listingPriceAtomic = params.listOnPublish ? assertListingPriceAtomic(params.listingPriceAtomic) : null

      // Resume sync for an already-executed mint TX (e.g. after a transient sync failure or page refresh)
      let digest = txDigest
      if (!digest && collectionBindOnChainId) {
        await preflightCollectionBindTarget(authHeaders, collectionBindOnChainId)
      }

      if (!digest) {
        setStatus('building')
        const personalKiosk = Object.prototype.hasOwnProperty.call(params, 'prefetchedPersonalKiosk')
          ? params.prefetchedPersonalKiosk
          : await resolvePersonalKiosk(authHeaders, suiWallet.address)
        await assertObjectInputsExist(suiClient, {
          'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
          'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
          'Soul character blob': params.protectedBlobObjectId,
          'Founding memory blob': params.foundingMemoryBlobObjectId ?? null,
          'Skills blob': params.skillsBlobObjectId ?? null,
          ...(collectionBindOnChainId ? { 'Bind target collection': collectionBindOnChainId } : {}),
        })
        const baseBuilderParams = {
          currentKioskId: personalKiosk?.currentKioskId ?? null,
          currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
          name: params.name,
          description: params.description,
          imageUrl: params.imageUrl,
          initialContent: buildLegacyInitialContent({
            protectedBlobObjectId: params.protectedBlobObjectId,
            foundingMemoryBlobObjectId: params.foundingMemoryBlobObjectId ?? null,
            skillsBlobObjectId: params.skillsBlobObjectId ?? null,
            initialSkillName: params.initialSkillName ?? null,
            skillsVisibility: params.skillsVisibility ?? 'private',
          }),
          initialStateConfig: buildLegacyInitialStateConfig({
            protectedBlobObjectId: params.protectedBlobObjectId,
          }),
          creatorRoyaltyBps: params.creatorRoyaltyBps,
          attachBeforeMint: params.attachBeforeMint,
        }
        let tx: Transaction
        switch (publishMode) {
          case 'plain':
            tx = await buildPublishSoulTx(baseBuilderParams)
            break
          case 'with-bind':
            tx = await buildPublishSoulWithBindTx({
              ...baseBuilderParams,
              collectionOnChainId: collectionBindOnChainId!,
            })
            break
          case 'with-list':
            tx = await buildPublishSoulWithListTx({
              ...baseBuilderParams,
              listingPriceAtomic: listingPriceAtomic!,
            })
            break
          case 'with-bind-and-list':
            tx = await buildPublishSoulWithCollectionAndListTx({
              ...baseBuilderParams,
              collectionOnChainId: collectionBindOnChainId!,
              listingPriceAtomic: listingPriceAtomic!,
            })
            break
        }

        setStatus('signing')
        // CRITICAL: exactly one signAndExecute per publish() invocation. The
        // bind / list calls live inside the same PTB as mint, so the wallet
        // signature count is 2 total (Walrus register + this combined PTB)
        // regardless of how many of {bind, list} are requested.
        const result = await signAndExecute(tx)
        const executedDigest = result.digest
        assertSoulidityTxSucceeded(result, 'Soul mint transaction')
        digest = executedDigest
        setTxDigest(executedDigest)

        const pendingSync = buildPublishSyncMaterial(params)
        const recovery: MintRecoveryState = attachSoulidityDeploymentSignature({
          userId: user?.id ?? '',
          txDigest: executedDigest,
          publishMode,
          collectionBindOnChainId,
          listingPriceAtomic: listingPriceAtomic == null ? null : listingPriceAtomic.toString(),
          pendingSync,
          syncBody: null,
        })
        recoveryRef.current = recovery
        persistMintRecovery(recovery)

        try { params.onMintTxExecuted?.() } catch { /* swallow callback errors */ }
        posthog.capture('soul_publish_sui_signed', {
          txDigest: executedDigest,
          publishMode,
          elapsedMs: Date.now() - startedAt,
        })

        const syncBody = await buildPublishSyncBody({
          txDigest: executedDigest,
          txResult: result,
          soulOnChainId: null,
          publishParams: pendingSync,
          suiClient,
        })
        const recoveryWithSyncBody = { ...recovery, syncBody }
        recoveryRef.current = recoveryWithSyncBody
        persistMintRecovery(recoveryWithSyncBody)
      }

      if (!digest) {
        throw new Error('Publish transaction digest is missing')
      }
      const recovery = recoveryRef.current?.txDigest === digest ? recoveryRef.current : null
      const recoveredPublishMode = recovery?.publishMode ?? publishMode
      const recoveredBindOnChainId = recovery?.collectionBindOnChainId ?? collectionBindOnChainId
      const recoveredListingPriceAtomic = recovery?.listingPriceAtomic ?? (listingPriceAtomic == null ? null : listingPriceAtomic.toString())
      let syncBody = recovery?.syncBody ?? null
      if (!syncBody) {
        const pendingSync = recovery?.pendingSync ?? buildPublishSyncMaterial(params)
        syncBody = await buildPublishSyncBody({
          txDigest: digest,
          txResult: await suiClient.getTransactionBlock({
            digest,
            options: { showEvents: true, showObjectChanges: true, showEffects: true, showInput: true },
          }),
          soulOnChainId: null,
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
      // Mirror in order: publish → add-soul → list — all using the SAME digest.
      // Each route extracts its own event from the bundled TX by route-id /
      // soulOnChainId, so unrelated events in the digest are ignored.
      const publishResp = await fetch('/api/souls/publish', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(syncBody),
      })
      if (!publishResp.ok) {
        const body = await publishResp.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror publish')
      }
      const syncData: PublishSyncResponse = await publishResp.json()
      let completedData: PublishSyncResponse = syncData

      if (recoveredBindOnChainId) {
        const addRes = await fetch(
          `/api/collections/${encodeURIComponent(recoveredBindOnChainId)}/add-soul`,
          {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ txDigest: digest, soulOnChainId: syncData.soulOnChainId }),
          },
        )
        if (!addRes.ok) {
          const body = await addRes.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to mirror collection bind')
        }
        const addData = await addRes.json().catch(() => ({})) as { collectionOnChainId?: string | null }
        completedData = {
          ...completedData,
          collectionOnChainId: addData.collectionOnChainId ?? recoveredBindOnChainId,
          collectionAddTxDigest: digest,
        }
      }

      if (recoveredPublishMode === 'with-list' || recoveredPublishMode === 'with-bind-and-list') {
        const listRes = await fetch(
          `/api/souls/${encodeURIComponent(syncData.soulOnChainId)}/list`,
          {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ txDigest: digest }),
          },
        )
        if (!listRes.ok) {
          const body = await listRes.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to mirror listing')
        }
        const listData = await listRes.json().catch(() => ({})) as {
          listingObjectOnChainId?: string | null
          listedPriceAtomic?: string | bigint | null
          listingStatus?: string
        }
        completedData = {
          ...completedData,
          listingTxDigest: digest,
          listingObjectOnChainId: listData.listingObjectOnChainId ?? null,
          listedPriceAtomic: listData.listedPriceAtomic == null ? recoveredListingPriceAtomic : String(listData.listedPriceAtomic),
          listingStatus: listData.listingStatus ?? completedData.listingStatus,
        }
      }

      setPublishData(completedData)
      setStatus('done')
      posthog.capture('soul_publish_completed', {
        txDigest: digest,
        publishMode: recoveredPublishMode,
        collectionOnChainId: completedData.collectionOnChainId ?? null,
        listed: recoveredPublishMode === 'with-list' || recoveredPublishMode === 'with-bind-and-list',
        elapsedMs: Date.now() - startedAt,
      })

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
