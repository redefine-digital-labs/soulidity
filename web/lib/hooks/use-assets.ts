'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Transaction } from '@mysten/sui/transactions'
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import { buildDeleteAssetVersionTx, buildInitAndBatchAppendAssetsTx } from '@/lib/soulidity/tx/assets'
import { buildClearActiveSpriteTx } from '@/lib/soulidity/tx/metadata'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { buildPersonaSpriteMoodMap, parsePersonaSpriteConfig } from '@/lib/soulidity/persona-sprite'
import { uploadSoulPayload } from '@/lib/upload/client-upload'
import { createAssetSealSidecarFromMaterial, type PendingSealMaterial } from '@/lib/upload/client-seal'
import { useUploadCostReview } from '@/components/upload/upload-cost-review'
import {
  extractAllAssetVersionAppendedEvents,
  extractAssetVersionAppendedEvent,
} from '@/lib/soulidity/events'
import { assertSoulidityTxSucceeded, getMarketAbortInfo } from '@/lib/soulidity/market-errors'
import { SuiTxExecutionError } from '@/lib/sui/tx-result'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@/lib/soulidity/client-session'
import type {
  SoulAssetDetail,
  SoulAssetVersionRecord,
  SoulAssetVersionsResponse,
  SoulDownloadPolicy,
} from '@/lib/soulidity/types'

const SPRITE_ASSET_NAME = 'persona-sprite'
const SPRITE_CONFIG_KEY = 'sprite.config.v1'
const SPRITE_MOOD_MAP_KEY = 'sprite.mood_map.v1'
const SPRITE_APPEND_RECOVERY_KEY_PREFIX = 'soul-sprite-append-recovery:'

type PendingAssetAction = 'append' | 'delete' | 'clear' | 'recovering' | null
type SuiObjectReadClient = {
  getObject: (input: { id: string; options: { showContent: true } }) => Promise<{
    data?: { content?: unknown } | null
  }>
}

interface SpriteAppendSyncBody {
  txDigest: string
  assetsSealSidecar: import('@/lib/services/seal-crypto').SealEnvelopeSidecar | null
  assetsSealSidecars?: Array<import('@/lib/services/seal-crypto').SealEnvelopeSidecar | null>
}

interface SpriteAppendRecoveryState {
  userId: string
  soulOnChainId: string
  syncBody?: SpriteAppendSyncBody | null
  pendingSync?: SpriteAppendSyncMaterial | null
  deploymentSignature: string
}

interface SpriteAppendSyncMaterial {
  txDigest: string
  sealMaterial?: PendingSealMaterial | null
  sealMaterials?: Array<PendingSealMaterial | null>
}

function spriteAppendRecoveryStorageKey(soulOnChainId: string) {
  return `${SPRITE_APPEND_RECOVERY_KEY_PREFIX}${soulOnChainId}`
}

function isSpriteAppendSyncBody(value: unknown): value is SpriteAppendSyncBody {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SpriteAppendSyncBody>
  return typeof candidate.txDigest === 'string'
    && candidate.txDigest.length > 0
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

function isSpriteAppendSyncMaterial(value: unknown): value is SpriteAppendSyncMaterial {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SpriteAppendSyncMaterial>
  return typeof candidate.txDigest === 'string'
    && candidate.txDigest.length > 0
    && (candidate.sealMaterial == null || isPendingSealMaterial(candidate.sealMaterial))
    && (
      candidate.sealMaterials == null
      || (Array.isArray(candidate.sealMaterials)
        && candidate.sealMaterials.every((material) => material == null || isPendingSealMaterial(material)))
    )
}

export function sanitizeSpriteAppendRecoveryState(
  raw: string | null,
  userId: string | null | undefined,
  soulOnChainId: string | null | undefined,
): SpriteAppendRecoveryState | null {
  if (!raw || !userId || !soulOnChainId) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SpriteAppendRecoveryState>
    if (
      parsed.userId !== userId
      || parsed.soulOnChainId !== soulOnChainId
      || (!isSpriteAppendSyncBody(parsed.syncBody) && !isSpriteAppendSyncMaterial(parsed.pendingSync))
      || !hasCurrentSoulidityDeploymentSignature(parsed)
    ) {
      return null
    }
    return {
      userId,
      soulOnChainId,
      syncBody: isSpriteAppendSyncBody(parsed.syncBody) ? parsed.syncBody : null,
      pendingSync: isSpriteAppendSyncMaterial(parsed.pendingSync) ? parsed.pendingSync : null,
      deploymentSignature: parsed.deploymentSignature,
    }
  } catch {
    return null
  }
}

function persistSpriteAppendRecovery(storageKey: string, recovery: SpriteAppendRecoveryState | null) {
  if (typeof window === 'undefined') return
  try {
    if (recovery) {
      sessionStorage.setItem(storageKey, JSON.stringify(recovery))
    } else {
      sessionStorage.removeItem(storageKey)
    }
  } catch {}
}

type AppendUploadResult = {
  blobId: string
  blobObjectId: string
  contentHash: string
  blobUrl: string
  sealMaterial?: PendingSealMaterial | null
}

function policyToU8(policy: SoulDownloadPolicy): number {
  switch (policy) {
    case 'public': return 0
    case 'owner_only': return 1
    case 'allowlist': return 2
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function normalizeObjectId(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const normalized = normalizeSuiAddress(trimmed)
    return isValidSuiAddress(normalized) ? normalized : null
  } catch {
    return null
  }
}

function readOptionalLiveObjectId(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return normalizeObjectId(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    return readOptionalLiveObjectId(value[0])
  }

  const record = asRecord(value)
  if (!record) return null
  if (typeof record.id === 'string') return normalizeObjectId(record.id)
  if (typeof record.bytes === 'string') return normalizeObjectId(record.bytes)
  if (Array.isArray(record.vec)) return readOptionalLiveObjectId(record.vec)
  if (record.fields != null) return readOptionalLiveObjectId(record.fields)
  if (record.value != null) return readOptionalLiveObjectId(record.value)
  return null
}

async function resolveLiveSoulAssetsOnChainId(
  client: SuiObjectReadClient,
  stateObjectId: string,
): Promise<string | null> {
  const response = await client.getObject({
    id: stateObjectId,
    options: { showContent: true },
  })
  const content = response.data?.content
  const contentRecord = asRecord(content)
  const fields = asRecord(contentRecord?.fields)
  if (!fields) {
    throw new Error('Soul state object is missing on-chain fields')
  }
  return readOptionalLiveObjectId(fields.assets_id)
}

function isAssetsRootAlreadyExistsError(error: unknown) {
  const marketAbort = getMarketAbortInfo(error)
  if (marketAbort?.entry?.name === 'EAssetsRootAlreadyExists' || marketAbort?.code === 34) {
    return true
  }
  if (!(error instanceof SuiTxExecutionError)) return false
  const detail = `${error.executionError ?? ''} ${error.message}`
  return /MoveAbort|abort|init_assets_and_append_sprite_as_owner/i.test(detail)
    && /(^|[\s,(:])34($|[\s,):])/i.test(detail)
}

function serializeSpriteConfig(raw: ReturnType<typeof parsePersonaSpriteConfig>) {
  if (!raw) return null
  return JSON.stringify({
    type: 'sprite-sheet' as const,
    frameWidth: raw.frameWidth,
    frameHeight: raw.frameHeight,
    columns: raw.columns,
    animations: raw.animations,
  })
}

function buildSpriteAppendTransaction(params: {
  packageId: string
  stateObjectId: string
  metadataObjectId: string
  assetsOnChainId: string | null
  blobObjectId: string
  visibility: 'public' | 'private'
  spriteConfigJson: string
  spriteMoodMapJson: string
  downloadPolicy: SoulDownloadPolicy
}) {
  if (!params.assetsOnChainId) {
    // New ABI: init_assets_and_append_sprite_as_owner returns SoulAssets;
    // the PTB MUST finalize_soul_assets in the same TX or it aborts. Route
    // through the batch builder so the finalize is always wired and the
    // 1-version case is the same code path as the multi-version case.
    return buildInitAndBatchAppendAssetsTx({
      stateObjectId: params.stateObjectId,
      metadataObjectId: params.metadataObjectId,
      initialSprite: {
        assetName: SPRITE_ASSET_NAME,
        visibility: params.visibility,
        blobObjectId: params.blobObjectId,
        spriteConfigJson: params.spriteConfigJson,
        spriteMoodMapJson: params.spriteMoodMapJson,
        spriteConfigKey: SPRITE_CONFIG_KEY,
        spriteMoodMapKey: SPRITE_MOOD_MAP_KEY,
        downloadPolicy: params.downloadPolicy,
      },
    })
  }

  const tx = new Transaction()
  const [appendedVersionIndex] = tx.moveCall({
    target: `${params.packageId}::assets::append_version_as_owner`,
    arguments: [
      tx.object(params.assetsOnChainId),
      tx.object(params.stateObjectId),
      tx.pure.string(SPRITE_ASSET_NAME),
      tx.pure.bool(params.visibility === 'public'),
      tx.pure.u8(0), // asset_type = sprite
      tx.object(params.blobObjectId),
      tx.object('0x6'),
    ],
  })

  tx.moveCall({
    target: `${params.packageId}::metadata::upsert_metadata_blob`,
    arguments: [
      tx.object(params.metadataObjectId),
      tx.object(params.stateObjectId),
      tx.pure.string(SPRITE_CONFIG_KEY),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(params.spriteConfigJson))),
    ],
  })
  tx.moveCall({
    target: `${params.packageId}::metadata::upsert_metadata_blob`,
    arguments: [
      tx.object(params.metadataObjectId),
      tx.object(params.stateObjectId),
      tx.pure.string(SPRITE_MOOD_MAP_KEY),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(params.spriteMoodMapJson))),
    ],
  })

  tx.moveCall({
    target: `${params.packageId}::market::set_active_sprite`,
    arguments: [
      tx.object(params.metadataObjectId),
      tx.object(params.stateObjectId),
      tx.object(params.assetsOnChainId),
      tx.pure.string(SPRITE_ASSET_NAME),
      appendedVersionIndex,
      tx.pure.u8(policyToU8(params.downloadPolicy)),
    ],
  })
  return tx
}

async function fetchSoulAssetVersions(soulId: string): Promise<SoulAssetVersionsResponse> {
  const response = await fetch(
    `/api/souls/${encodeURIComponent(soulId)}/assets`,
    { cache: 'no-store' },
  )
  if (!response.ok) throw new Error('Failed to fetch asset versions')
  return response.json()
}

export function useAssets(soul: SoulAssetDetail | null) {
  const [pending, setPending] = useState<PendingAssetAction>(null)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
  const { getAuthHeaders, user } = useAuth()
  const { requestUploadCostApproval } = useUploadCostReview()
  const pendingRecoveryRef = useRef<Record<string, boolean>>({})

  const postAppendMirror = useCallback(async (
    soulOnChainId: string,
    syncBody: SpriteAppendSyncBody,
  ) => {
    const authHeaders = await getAuthHeaders()
    const mirrorResponse = await fetch(
      `/api/souls/${encodeURIComponent(soulOnChainId)}/assets`,
      {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(syncBody),
      },
    )
    const mirrorPayload = await mirrorResponse.json().catch(() => null)
    if (!mirrorResponse.ok) {
      throw new Error(
        mirrorPayload && typeof mirrorPayload === 'object' && typeof mirrorPayload.error === 'string'
          ? mirrorPayload.error
          : 'Failed to mirror sprite append transaction',
      )
    }
  }, [getAuthHeaders])

  const buildSpriteAppendSyncBody = useCallback(async (params: {
    txDigest: string
    txResult: unknown
    sealMaterial?: PendingSealMaterial | null
    sealMaterials?: Array<PendingSealMaterial | null>
  }): Promise<SpriteAppendSyncBody> => {
    let assetsSealSidecar = null
    let assetsSealSidecars: Array<import('@/lib/services/seal-crypto').SealEnvelopeSidecar | null> | undefined
    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
    if (params.sealMaterials) {
      const appendedEvents = extractAllAssetVersionAppendedEvents(params.txResult as never, packageId)
      if (appendedEvents.length < params.sealMaterials.length) {
        throw new Error('Sprite append transaction emitted fewer events than uploaded versions')
      }
      assetsSealSidecars = await Promise.all(params.sealMaterials.map(async (material, index) => {
        if (!material) return null
        const appended = appendedEvents[index]
        return createAssetSealSidecarFromMaterial({
          suiClient: suiClient as never,
          packageId,
          assetsObjectId: appended.assetsId,
          assetName: appended.assetName,
          versionIndex: appended.versionIndex,
          material,
        })
      }))
      assetsSealSidecar = assetsSealSidecars[0] ?? null
    } else if (params.sealMaterial) {
      const appended = extractAssetVersionAppendedEvent(params.txResult as never, packageId)
      assetsSealSidecar = await createAssetSealSidecarFromMaterial({
        suiClient: suiClient as never,
        packageId,
        assetsObjectId: appended.assetsId,
        assetName: appended.assetName,
        versionIndex: appended.versionIndex,
        material: params.sealMaterial,
      })
    }
    return {
      txDigest: params.txDigest,
      assetsSealSidecar,
      ...(assetsSealSidecars ? { assetsSealSidecars } : {}),
    }
  }, [suiClient])

  const resumePendingSpriteAppendMirror = useCallback(async (
    soulOnChainId: string,
    userId: string | null | undefined,
  ) => {
    if (typeof window === 'undefined' || !userId) return false
    if (pendingRecoveryRef.current[soulOnChainId]) {
      return true
    }

    const storageKey = spriteAppendRecoveryStorageKey(soulOnChainId)
    const recovery = sanitizeSpriteAppendRecoveryState(
      sessionStorage.getItem(storageKey),
      userId,
      soulOnChainId,
    )
    if (!recovery) {
      // Either no pending recovery, or it belongs to a different user/deployment — drop it.
      try { sessionStorage.removeItem(storageKey) } catch {}
      return false
    }

    pendingRecoveryRef.current[soulOnChainId] = true
    setPending('recovering')
    setError(null)
    try {
      let syncBody = recovery.syncBody ?? null
      if (!syncBody && recovery.pendingSync) {
        syncBody = await buildSpriteAppendSyncBody({
          txDigest: recovery.pendingSync.txDigest,
          txResult: await suiClient.getTransactionBlock({
            digest: recovery.pendingSync.txDigest,
            options: { showEvents: true, showObjectChanges: true, showEffects: true, showInput: true },
          }),
          sealMaterial: recovery.pendingSync.sealMaterial,
          sealMaterials: recovery.pendingSync.sealMaterials,
        })
        recovery.syncBody = syncBody
        persistSpriteAppendRecovery(storageKey, recovery)
      }
      if (!syncBody) {
        throw new Error('Pending sprite append recovery is missing sync data')
      }
      await postAppendMirror(soulOnChainId, syncBody)
      persistSpriteAppendRecovery(storageKey, null)
      await queryClient.invalidateQueries({ queryKey: ['soul', soulOnChainId] })
      await queryClient.invalidateQueries({ queryKey: ['soul-asset-versions', soulOnChainId] })
      return true
    } finally {
      pendingRecoveryRef.current[soulOnChainId] = false
      setPending(null)
    }
  }, [buildSpriteAppendSyncBody, postAppendMirror, queryClient, suiClient])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const soulOnChainId = soul?.onChainId
    const userId = user?.id
    if (!soulOnChainId || !userId) return
    void Promise.resolve()
      .then(() => resumePendingSpriteAppendMirror(soulOnChainId, userId))
      .catch((nextError) => {
        // Leave the recovery row in place so the user can retry via a subsequent append/reload.
        setError(
          nextError instanceof Error
            ? `Pending sprite append mirror failed: ${nextError.message}`
            : 'Pending sprite append mirror failed',
        )
      })
  }, [soul?.onChainId, user?.id, resumePendingSpriteAppendMirror])

  const assetsQuery = useQuery<SoulAssetVersionsResponse>({
    queryKey: ['soul-asset-versions', soul?.onChainId ?? null],
    enabled: Boolean(soul?.onChainId),
    queryFn: async () => {
      if (!soul?.onChainId) throw new Error('Soul is required to fetch asset versions')
      return fetchSoulAssetVersions(soul.onChainId)
    },
  })

  const spriteVersions = useMemo<SoulAssetVersionRecord[]>(() => {
    const versions = assetsQuery.data?.assets ?? []
    return versions
      .filter((v) => v.assetName === SPRITE_ASSET_NAME)
      .sort((a, b) => a.versionIndex - b.versionIndex)
  }, [assetsQuery.data?.assets])

  const canManage = Boolean(soul?.isOwner && soul?.metadataOnChainId)

  async function uploadAssetFile(file: File, visibility: 'public' | 'private'): Promise<AppendUploadResult> {
    if (!suiWallet) throw new Error('Bind a Sui wallet before uploading sprite assets')
    const authHeaders = await getAuthHeaders()
    const uploaded = await uploadSoulPayload({
      file,
      uploadType: visibility === 'public' ? 'public' : 'encrypted',
      kind: 'persona-sprite',
      authHeaders,
      sendObjectTo: suiWallet.address,
      walletAddress: suiWallet.address,
      suiClient,
      signAndExecute,
      confirmQuote: requestUploadCostApproval,
    })
    return {
      blobId: uploaded.blobId,
      blobObjectId: uploaded.blobObjectId,
      contentHash: uploaded.contentHash,
      blobUrl: uploaded.blobUrl,
      sealMaterial: uploaded.sealMaterial ?? null,
    }
  }

  async function appendAndActivateSprite(params: {
    sheetFile: File
    configFile: File
    visibility: 'public' | 'private'
  }) {
    if (!soul || !suiWallet) throw new Error('Sign in and load the Soul before uploading a sprite')
    if (!soul.isOwner) throw new Error('Only the Soul owner can update sprite versions')
    if (!soul.metadataOnChainId) {
      throw new Error('Soul is missing on-chain metadata root')
    }
    try {
      const resumedPendingMirror = await resumePendingSpriteAppendMirror(soul.onChainId, user?.id)
      if (resumedPendingMirror) return
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? `Pending sprite append mirror failed: ${nextError.message}`
          : 'Pending sprite append mirror failed',
      )
      throw nextError
    }

    const config = parsePersonaSpriteConfig(await params.configFile.text())
    if (!config) throw new Error('Sprite config JSON is invalid')

    setPending('append')
    setError(null)
    try {
      const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
      const initialAssetsOnChainId = await resolveLiveSoulAssetsOnChainId(suiClient, soul.stateOnChainId)
      await assertObjectInputsExist(suiClient, {
        'Soul state': soul.stateOnChainId,
        'Soul metadata': soul.metadataOnChainId,
        'Soul assets': initialAssetsOnChainId,
      })

      const uploaded = await uploadAssetFile(params.sheetFile, params.visibility)
      // Reject before signing — burning a Soul mint of gas on a private upload
      // that has no Seal material to ship to the mirror route is wasteful and
      // would leave an on-chain version with no readable encryption envelope.
      if (params.visibility === 'private' && !uploaded.sealMaterial) {
        throw new Error('Private sprite upload is missing Seal material')
      }
      await assertObjectInputsExist(suiClient, {
        'Uploaded sprite blob': uploaded.blobObjectId,
      })

      // One PTB. Two shapes:
      //   * No assets root yet → market::init_assets_and_append_sprite_as_owner
      //     atomically creates the SoulAssets root, appends version 0, upserts
      //     both sprite metadata blobs, and binds the active sprite.
      //   * Assets root present → append_version_as_owner returns the new
      //     version index, threaded into set_active_sprite within the same
      //     PTB so the activation targets the version this call appended.
      // Both shapes emit the same AssetVersionAppended event, so the mirror
      // route handles them identically.
      const downloadPolicy: SoulDownloadPolicy = params.visibility === 'public' ? 'public' : 'owner_only'
      const spriteConfigJson = serializeSpriteConfig(config) ?? '{}'
      const moodMap = buildPersonaSpriteMoodMap(config.animations)
      const spriteMoodMapJson = JSON.stringify(moodMap)

      let result
      try {
        result = await signAndExecute(buildSpriteAppendTransaction({
          packageId,
          stateObjectId: soul.stateOnChainId,
          metadataObjectId: soul.metadataOnChainId!,
          assetsOnChainId: initialAssetsOnChainId,
          blobObjectId: uploaded.blobObjectId,
          visibility: params.visibility,
          spriteConfigJson,
          spriteMoodMapJson,
          downloadPolicy,
        }))
        assertSoulidityTxSucceeded(result, 'Soul sprite asset transaction')
      } catch (txError) {
        if (initialAssetsOnChainId || !isAssetsRootAlreadyExistsError(txError)) {
          throw txError
        }
        const retryAssetsOnChainId = await resolveLiveSoulAssetsOnChainId(suiClient, soul.stateOnChainId)
        if (!retryAssetsOnChainId) {
          throw txError
        }
        await assertObjectInputsExist(suiClient, {
          'Soul assets': retryAssetsOnChainId,
          'Uploaded sprite blob': uploaded.blobObjectId,
        })
        result = await signAndExecute(buildSpriteAppendTransaction({
          packageId,
          stateObjectId: soul.stateOnChainId,
          metadataObjectId: soul.metadataOnChainId!,
          assetsOnChainId: retryAssetsOnChainId,
          blobObjectId: uploaded.blobObjectId,
          visibility: params.visibility,
          spriteConfigJson,
          spriteMoodMapJson,
          downloadPolicy,
        }))
        assertSoulidityTxSucceeded(result, 'Soul sprite asset transaction retry')
      }
      const pendingSync: SpriteAppendSyncMaterial = {
        txDigest: result.digest,
        sealMaterial: params.visibility === 'private' ? uploaded.sealMaterial : null,
      }

      const storageKey = spriteAppendRecoveryStorageKey(soul.onChainId)
      let recovery: SpriteAppendRecoveryState | null = null
      if (user?.id && typeof window !== 'undefined') {
        recovery = attachSoulidityDeploymentSignature({
          userId: user.id,
          soulOnChainId: soul.onChainId,
          pendingSync,
          syncBody: null,
        })
        persistSpriteAppendRecovery(storageKey, recovery)
      }

      const syncBody = await buildSpriteAppendSyncBody({
        txDigest: result.digest,
        txResult: result,
        sealMaterial: pendingSync.sealMaterial,
      })
      if (recovery) {
        recovery.syncBody = syncBody
        persistSpriteAppendRecovery(storageKey, recovery)
      }

      try {
        await postAppendMirror(soul.onChainId, syncBody)
        persistSpriteAppendRecovery(storageKey, null)
      } catch (mirrorError) {
        // Leave the recovery row in place for the auto-resume effect on the next mount.
        throw mirrorError
      }

      await queryClient.invalidateQueries({ queryKey: ['soul', soul.onChainId] })
      await queryClient.invalidateQueries({ queryKey: ['soul-asset-versions', soul.onChainId] })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to upload sprite version')
      throw nextError
    } finally {
      setPending(null)
    }
  }

  async function appendAndActivateSprites(params: {
    drafts: Array<{ sheetFile: File; configFile: File }>
    visibility: 'public' | 'private'
  }) {
    if (params.drafts.length === 0) {
      throw new Error('Select at least one sprite draft')
    }
    if (params.drafts.length === 1 || soul?.assetsOnChainId) {
      for (const draft of params.drafts) {
        await appendAndActivateSprite({ ...draft, visibility: params.visibility })
      }
      return
    }
    if (!soul || !suiWallet) throw new Error('Sign in and load the Soul before uploading sprites')
    if (!soul.isOwner) throw new Error('Only the Soul owner can update sprite versions')
    if (!soul.metadataOnChainId) {
      throw new Error('Soul is missing on-chain metadata root')
    }

    const drafts = params.drafts
    const parsedDrafts = await Promise.all(drafts.map(async (draft, index) => {
      const config = parsePersonaSpriteConfig(await draft.configFile.text())
      if (!config) throw new Error(`Sprite config JSON #${index + 1} is invalid`)
      const spriteConfigJson = serializeSpriteConfig(config) ?? '{}'
      const moodMap = buildPersonaSpriteMoodMap(config.animations)
      return {
        ...draft,
        spriteConfigJson,
        spriteMoodMapJson: JSON.stringify(moodMap),
      }
    }))

    setPending('append')
    setError(null)
    try {
      const initialAssetsOnChainId = await resolveLiveSoulAssetsOnChainId(suiClient, soul.stateOnChainId)
      if (initialAssetsOnChainId) {
        for (const draft of drafts) {
          await appendAndActivateSprite({ ...draft, visibility: params.visibility })
        }
        return
      }

      await assertObjectInputsExist(suiClient, {
        'Soul state': soul.stateOnChainId,
        'Soul metadata': soul.metadataOnChainId,
      })
      const uploadedSprites = await Promise.all(drafts.map((draft) => uploadAssetFile(draft.sheetFile, params.visibility)))
      for (let i = 0; i < uploadedSprites.length; i++) {
        const uploaded = uploadedSprites[i]
        if (!uploaded.blobObjectId) {
          throw new Error(`Uploaded sprite #${i + 1} is missing blobObjectId`)
        }
        if (params.visibility === 'private' && !uploaded.sealMaterial) {
          throw new Error(`Private sprite upload #${i + 1} is missing Seal material`)
        }
      }
      const objectInputs: Record<string, string | null> = {
        'Soul state': soul.stateOnChainId,
        'Soul metadata': soul.metadataOnChainId,
      }
      uploadedSprites.forEach((uploaded, index) => {
        objectInputs[`Uploaded sprite blob #${index + 1}`] = uploaded.blobObjectId
      })
      await assertObjectInputsExist(suiClient, objectInputs)

      const downloadPolicy: SoulDownloadPolicy = params.visibility === 'public' ? 'public' : 'owner_only'
      const activeDraft = parsedDrafts[parsedDrafts.length - 1]
      const result = await signAndExecute(buildInitAndBatchAppendAssetsTx({
        stateObjectId: soul.stateOnChainId,
        metadataObjectId: soul.metadataOnChainId,
        initialSprite: {
          assetName: SPRITE_ASSET_NAME,
          visibility: params.visibility,
          blobObjectId: uploadedSprites[0].blobObjectId,
          spriteConfigJson: parsedDrafts[0].spriteConfigJson,
          spriteMoodMapJson: parsedDrafts[0].spriteMoodMapJson,
          spriteConfigKey: SPRITE_CONFIG_KEY,
          spriteMoodMapKey: SPRITE_MOOD_MAP_KEY,
          downloadPolicy,
        },
        additionalSprites: uploadedSprites.slice(1).map((uploaded) => ({
          assetName: SPRITE_ASSET_NAME,
          visibility: params.visibility,
          blobObjectId: uploaded.blobObjectId,
        })),
        rebindActiveSprite: uploadedSprites.length > 1
          ? {
              assetName: SPRITE_ASSET_NAME,
              versionIndex: uploadedSprites.length - 1,
              downloadPolicy,
              metadataUpserts: [
                { key: SPRITE_CONFIG_KEY, valueJson: activeDraft.spriteConfigJson },
                { key: SPRITE_MOOD_MAP_KEY, valueJson: activeDraft.spriteMoodMapJson },
              ],
            }
          : null,
      }))
      assertSoulidityTxSucceeded(result, 'Soul sprite asset batch transaction')

      const pendingSync: SpriteAppendSyncMaterial = {
        txDigest: result.digest,
        sealMaterials: params.visibility === 'private'
          ? uploadedSprites.map((uploaded) => uploaded.sealMaterial ?? null)
          : uploadedSprites.map(() => null),
      }
      const storageKey = spriteAppendRecoveryStorageKey(soul.onChainId)
      let recovery: SpriteAppendRecoveryState | null = null
      if (user?.id && typeof window !== 'undefined') {
        recovery = attachSoulidityDeploymentSignature({
          userId: user.id,
          soulOnChainId: soul.onChainId,
          pendingSync,
          syncBody: null,
        })
        persistSpriteAppendRecovery(storageKey, recovery)
      }

      const syncBody = await buildSpriteAppendSyncBody({
        txDigest: result.digest,
        txResult: result,
        sealMaterials: pendingSync.sealMaterials,
      })
      if (recovery) {
        recovery.syncBody = syncBody
        persistSpriteAppendRecovery(storageKey, recovery)
      }

      await postAppendMirror(soul.onChainId, syncBody)
      persistSpriteAppendRecovery(storageKey, null)
      await queryClient.invalidateQueries({ queryKey: ['soul', soul.onChainId] })
      await queryClient.invalidateQueries({ queryKey: ['soul-asset-versions', soul.onChainId] })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to upload sprite versions')
      throw nextError
    } finally {
      setPending(null)
    }
  }

  async function deleteVersion(version: SoulAssetVersionRecord) {
    if (!soul || !suiWallet) throw new Error('Sign in and load the Soul before deleting a sprite version')
    if (!soul.isOwner) throw new Error('Only the Soul owner can delete sprite versions')
    if (!soul.assetsOnChainId || !soul.metadataOnChainId) {
      throw new Error('Soul is missing on-chain assets/metadata roots')
    }
    setPending('delete')
    setError(null)
    try {
      await assertObjectInputsExist(suiClient, {
        'Soul state': soul.stateOnChainId,
        'Soul metadata': soul.metadataOnChainId,
        'Soul assets': soul.assetsOnChainId,
      })
      const tx = buildDeleteAssetVersionTx({
        stateObjectId: soul.stateOnChainId,
        metadataObjectId: soul.metadataOnChainId,
        assetsObjectId: soul.assetsOnChainId,
        assetName: version.assetName,
        versionIndex: version.versionIndex,
      })
      const result = await signAndExecute(tx)

      const authHeaders = await getAuthHeaders()
      const response = await fetch(
        `/api/souls/${encodeURIComponent(soul.onChainId)}/assets/${encodeURIComponent(version.assetName)}/versions/${encodeURIComponent(String(version.versionIndex))}/delete`,
        {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ txDigest: result.digest }),
        },
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === 'object' && typeof payload.error === 'string'
            ? payload.error
            : 'Failed to mirror sprite delete transaction',
        )
      }

      await queryClient.invalidateQueries({ queryKey: ['soul', soul.onChainId] })
      await queryClient.invalidateQueries({ queryKey: ['soul-asset-versions', soul.onChainId] })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to delete sprite version')
      throw nextError
    } finally {
      setPending(null)
    }
  }

  async function clearActive() {
    if (!soul || !suiWallet) throw new Error('Sign in and load the Soul before clearing the active sprite')
    if (!soul.isOwner) throw new Error('Only the Soul owner can clear the active sprite')
    if (!soul.metadataOnChainId) throw new Error('Soul is missing on-chain metadata root')
    setPending('clear')
    setError(null)
    try {
      await assertObjectInputsExist(suiClient, {
        'Soul state': soul.stateOnChainId,
        'Soul metadata': soul.metadataOnChainId,
      })
      const tx = buildClearActiveSpriteTx({
        metadataObjectId: soul.metadataOnChainId,
        stateObjectId: soul.stateOnChainId,
      })
      const result = await signAndExecute(tx)

      const authHeaders = await getAuthHeaders()
      const response = await fetch(
        `/api/souls/${encodeURIComponent(soul.onChainId)}/metadata`,
        {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ txDigest: result.digest }),
        },
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === 'object' && typeof payload.error === 'string'
            ? payload.error
            : 'Failed to mirror clear active sprite transaction',
        )
      }

      await queryClient.invalidateQueries({ queryKey: ['soul', soul.onChainId] })
      await queryClient.invalidateQueries({ queryKey: ['soul-asset-versions', soul.onChainId] })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to clear active sprite')
      throw nextError
    } finally {
      setPending(null)
    }
  }

  return {
    pending,
    error,
    canManage,
    spriteVersions,
    isLoading: assetsQuery.isLoading,
    appendAndActivateSprite,
    appendAndActivateSprites,
    deleteVersion,
    clearActive,
  }
}
