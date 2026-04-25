'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Transaction } from '@mysten/sui/transactions'

import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
import { useAuth } from '@/components/providers/auth-provider'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import { buildDeleteAssetVersionTx } from '@/lib/soulidity/tx/assets'
import { buildClearActiveSpriteTx } from '@/lib/soulidity/tx/metadata'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { buildPersonaSpriteMoodMap, parsePersonaSpriteConfig } from '@/lib/soulidity/persona-sprite'
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
const PRIVATE_SPRITE_LEGACY_UPLOAD_MAX_BYTES = 4 * 1024 * 1024

// Vercel Blob's `allowedContentTypes` (see `/api/souls/upload/sprite-token`)
// only accepts these sprite MIME values, but some browsers and OS integrations
// leave `File.type` blank for an otherwise valid sprite sheet. The server-side
// pipeline already accepts an empty MIME and validates by byte signature, so
// for the public direct-upload path we infer a known sprite MIME from the file
// extension before calling Vercel Blob's `clientUpload`.
function inferPublicSpriteContentType(file: File): string {
  if (file.type) return file.type
  const lowerName = file.name.toLowerCase()
  if (lowerName.endsWith('.png')) return 'image/png'
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerName.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

type PendingAssetAction = 'append' | 'delete' | 'clear' | 'recovering' | null

interface SpriteAppendSyncBody {
  txDigest: string
  rawAssetsEnvelope: string | null
}

interface SpriteAppendRecoveryState {
  userId: string
  soulOnChainId: string
  syncBody: SpriteAppendSyncBody
  deploymentSignature: string
}

function spriteAppendRecoveryStorageKey(soulOnChainId: string) {
  return `${SPRITE_APPEND_RECOVERY_KEY_PREFIX}${soulOnChainId}`
}

function isSpriteAppendSyncBody(value: unknown): value is SpriteAppendSyncBody {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SpriteAppendSyncBody>
  return typeof candidate.txDigest === 'string'
    && candidate.txDigest.length > 0
    && (candidate.rawAssetsEnvelope === null || typeof candidate.rawAssetsEnvelope === 'string')
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
      || !isSpriteAppendSyncBody(parsed.syncBody)
      || !hasCurrentSoulidityDeploymentSignature(parsed)
    ) {
      return null
    }
    return {
      userId,
      soulOnChainId,
      syncBody: parsed.syncBody,
      deploymentSignature: parsed.deploymentSignature,
    }
  } catch {
    return null
  }
}

type AppendUploadResult = {
  blobId: string
  blobObjectId: string
  contentHash: string
  blobUrl: string
  sealDekEnvelope?: string | null
}

function policyToU8(policy: SoulDownloadPolicy): number {
  switch (policy) {
    case 'public': return 0
    case 'owner_only': return 1
    case 'allowlist': return 2
  }
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
  const { suiWallet, signAndExecute, suiClient } = usePrivySuiSign()
  const { getAuthHeaders, user } = useAuth()
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

  useEffect(() => {
    if (typeof window === 'undefined') return
    const soulOnChainId = soul?.onChainId
    const userId = user?.id
    if (!soulOnChainId || !userId) return
    if (pendingRecoveryRef.current[soulOnChainId]) return

    const storageKey = spriteAppendRecoveryStorageKey(soulOnChainId)
    const recovery = sanitizeSpriteAppendRecoveryState(
      sessionStorage.getItem(storageKey),
      userId,
      soulOnChainId,
    )
    if (!recovery) {
      // Either no pending recovery, or it belongs to a different user/deployment — drop it.
      try { sessionStorage.removeItem(storageKey) } catch {}
      return
    }

    pendingRecoveryRef.current[soulOnChainId] = true
    void (async () => {
      setPending('recovering')
      setError(null)
      try {
        await postAppendMirror(soulOnChainId, recovery.syncBody)
        try { sessionStorage.removeItem(storageKey) } catch {}
        await queryClient.invalidateQueries({ queryKey: ['soul', soulOnChainId] })
        await queryClient.invalidateQueries({ queryKey: ['soul-asset-versions', soulOnChainId] })
      } catch (nextError) {
        // Leave the recovery row in place so the user can retry via a subsequent append/reload.
        setError(
          nextError instanceof Error
            ? `Pending sprite append mirror failed: ${nextError.message}`
            : 'Pending sprite append mirror failed',
        )
      } finally {
        pendingRecoveryRef.current[soulOnChainId] = false
        setPending(null)
      }
    })()
  }, [soul?.onChainId, user?.id, postAppendMirror, queryClient])

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

  const canManage = Boolean(soul?.isOwner && soul?.assetsOnChainId && soul?.metadataOnChainId)

  async function uploadAssetFile(file: File, visibility: 'public' | 'private'): Promise<AppendUploadResult> {
    if (!suiWallet) throw new Error('Bind a Sui wallet before uploading sprite assets')
    const authHeaders = await getAuthHeaders()
    const uploadType = visibility === 'public' ? 'public' : 'encrypted'

    if (visibility === 'private') {
      if (file.size > PRIVATE_SPRITE_LEGACY_UPLOAD_MAX_BYTES) {
        throw new Error('Private sprite uploads are limited to 4 MB until encrypted direct upload is available.')
      }
      const formData = new FormData()
      formData.set('file', file)
      formData.set('type', uploadType)
      formData.set('sendObjectTo', suiWallet.address)
      const response = await fetch('/api/souls/upload', { method: 'POST', headers: authHeaders, body: formData })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === 'object' && typeof payload.error === 'string'
            ? payload.error
            : 'Failed to upload sprite payload',
        )
      }
      const uploaded = payload as AppendUploadResult
      if (!uploaded.blobObjectId) throw new Error('Upload response is missing blobObjectId')
      return uploaded
    }

    // Step 1: client direct-upload to Vercel Blob. This bypasses Vercel
    // serverless functions' 4.5 MB inbound body limit, which would otherwise
    // reject typical sprite sheets (~8 MB) with an HTML 413 before our API
    // route ever runs.
    const { upload: clientUpload } = await import('@vercel/blob/client')
    const uploadNonce = crypto.randomUUID()
    const uploaded = await clientUpload(`souls/sprite/${file.name || 'sprite'}`, file, {
      access: 'public',
      handleUploadUrl: '/api/souls/upload/sprite-token',
      contentType: inferPublicSpriteContentType(file),
      clientPayload: JSON.stringify({ kind: 'persona-sprite', nonce: uploadNonce }),
      headers: authHeaders,
    })

    // Step 2: server finalizes — pulls bytes from Vercel Blob, runs the same
    // validation / (optional) AES-GCM encryption pipeline as /api/souls/upload,
    // uploads to Walrus, deletes the temp Vercel Blob, returns the Walrus
    // blobObjectId used in the on-chain TX.
    let payload: unknown = null
    let response: Response | null = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await fetch('/api/souls/upload/from-blob', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vercelBlobUrl: uploaded.url,
          uploadNonce,
          type: uploadType,
          sendObjectTo: suiWallet.address,
          fileName: file.name,
          fileType: file.type,
        }),
      })
      payload = await response.json().catch(() => null)
      if (response.ok || response.status !== 409) break
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
    if (!response?.ok) {
      const errorMessage = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : 'Failed to upload sprite payload'
      throw new Error(errorMessage)
    }
    const finalized = payload as AppendUploadResult
    if (!finalized.blobObjectId) throw new Error('Upload response is missing blobObjectId')
    return finalized
  }

  async function appendAndActivateSprite(params: {
    sheetFile: File
    configFile: File
    visibility: 'public' | 'private'
  }) {
    if (!soul || !suiWallet) throw new Error('Sign in and load the Soul before uploading a sprite')
    if (!soul.isOwner) throw new Error('Only the Soul owner can update sprite versions')
    if (!soul.assetsOnChainId || !soul.metadataOnChainId) {
      throw new Error('Soul is missing on-chain assets/metadata roots')
    }
    const config = parsePersonaSpriteConfig(await params.configFile.text())
    if (!config) throw new Error('Sprite config JSON is invalid')

    setPending('append')
    setError(null)
    try {
      const uploaded = await uploadAssetFile(params.sheetFile, params.visibility)
      await assertObjectInputsExist(suiClient, {
        'Soul state': soul.stateOnChainId,
        'Soul metadata': soul.metadataOnChainId,
        'Soul assets': soul.assetsOnChainId,
        'Uploaded sprite blob': uploaded.blobObjectId,
      })

      // One PTB: append_version + upsert sprite metadata blobs + set_active_sprite.
      // The mirror route picks up AssetVersionAppendedEvent, and
      // `syncSoulProjectionFromChain` then reads SoulMetadata (which includes
      // the newly upserted blobs + active binding) so the DB row ends up in
      // the same shape as if we had called /assets and /metadata separately.
      const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
      const tx = new Transaction()
      // `append_version_as_owner` returns the `u64` version index assigned at
      // execution time by `versions.length()`. Capture it and thread it into
      // `set_active_sprite` within the same PTB so the activation always
      // targets the version this call actually appended, even if a concurrent
      // append from another tab or external writer allocates a different
      // index after we read the DB snapshot.
      const [appendedVersionIndex] = tx.moveCall({
        target: `${packageId}::assets::append_version_as_owner`,
        arguments: [
          tx.object(soul.assetsOnChainId),
          tx.object(soul.stateOnChainId),
          tx.pure.string(SPRITE_ASSET_NAME),
          tx.pure.bool(params.visibility === 'public'),
          tx.pure.u8(0), // asset_type = sprite
          tx.object(uploaded.blobObjectId),
          tx.object('0x6'),
        ],
      })

      const spriteConfigJson = serializeSpriteConfig(config) ?? '{}'
      const moodMap = buildPersonaSpriteMoodMap(config.animations)
      const spriteMoodMapJson = JSON.stringify(moodMap)
      tx.moveCall({
        target: `${packageId}::metadata::upsert_metadata_blob`,
        arguments: [
          tx.object(soul.metadataOnChainId),
          tx.object(soul.stateOnChainId),
          tx.pure.string(SPRITE_CONFIG_KEY),
          tx.pure.vector('u8', Array.from(new TextEncoder().encode(spriteConfigJson))),
        ],
      })
      tx.moveCall({
        target: `${packageId}::metadata::upsert_metadata_blob`,
        arguments: [
          tx.object(soul.metadataOnChainId),
          tx.object(soul.stateOnChainId),
          tx.pure.string(SPRITE_MOOD_MAP_KEY),
          tx.pure.vector('u8', Array.from(new TextEncoder().encode(spriteMoodMapJson))),
        ],
      })

      const downloadPolicy: SoulDownloadPolicy = params.visibility === 'public' ? 'public' : 'owner_only'
      tx.moveCall({
        target: `${packageId}::market::set_active_sprite`,
        arguments: [
          tx.object(soul.metadataOnChainId),
          tx.object(soul.stateOnChainId),
          tx.object(soul.assetsOnChainId),
          tx.pure.string(SPRITE_ASSET_NAME),
          appendedVersionIndex,
          tx.pure.u8(policyToU8(downloadPolicy)),
        ],
      })

      const result = await signAndExecute(tx)

      const syncBody: SpriteAppendSyncBody = {
        txDigest: result.digest,
        rawAssetsEnvelope: params.visibility === 'private' ? uploaded.sealDekEnvelope ?? null : null,
      }

      // Persist recovery before the mirror POST so a tab reload / network failure between
      // signing and mirror can resume with the original `rawAssetsEnvelope` — the server
      // cannot reconstruct it from chain data or Walrus after the fact.
      const storageKey = spriteAppendRecoveryStorageKey(soul.onChainId)
      if (user?.id && typeof window !== 'undefined') {
        const recovery: SpriteAppendRecoveryState = attachSoulidityDeploymentSignature({
          userId: user.id,
          soulOnChainId: soul.onChainId,
          syncBody,
        })
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(recovery))
        } catch {}
      }

      try {
        await postAppendMirror(soul.onChainId, syncBody)
        try { sessionStorage.removeItem(storageKey) } catch {}
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
    deleteVersion,
    clearActive,
  }
}
