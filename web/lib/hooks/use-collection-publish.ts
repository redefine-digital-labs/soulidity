'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import { buildCreateCollectionTx, buildAddSoulToCollectionTx } from '@/lib/soulidity/tx/collection'
import { buildPublishSoulTx } from '@/lib/soulidity/tx/publish'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
import { useAuth } from '@/components/providers/auth-provider'
import type { SoulFolderMap } from '@/components/providers/create-collection-provider'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@/lib/soulidity/client-session'
import { assertObjectInputsExist, findMissingObjectIds } from '@/lib/soulidity/object-inputs'

const RECOVERY_KEY = 'collection-mint-recovery'

const RECOVERY_VERSION = 8 as const

interface SoulUploadRecovery {
  protectedBlobObjectId: string
  sealDekEnvelope: string
  foundingMemoryBlobObjectId: string
  memorySealDekEnvelope: string
  skillsBlobObjectId: string | null
  initialSkillName: string | null
  skillsSealDekEnvelope: string | null
  imageUrl: string
}

interface RecoverySoulState {
  input: BatchSoulToMint
  uploads: SoulUploadRecovery | null
  /** Digest from successful signAndExecute — persisted before sync to prevent duplicate mints on retry */
  mintDigest: string | null
  mintSync: PublishSyncResponse | null
  /** Digest from successful signAndExecute(addTx) — persisted before mirror to prevent duplicate bind on retry */
  bindDigest: string | null
  bindTxDigest: string | null
}

interface CollectionRecoveryMeta {
  name: string
  description: string
  extraRoyaltyBps: number
  tradeable: boolean
}

interface RecoveryState {
  version: typeof RECOVERY_VERSION
  userId: string
  draftSignature: string | null
  txDigest: string | null
  floorPriceAtomic: string | null
  uploadedImageUrl: string | null
  collectionData: CollectionSyncResponse | null
  collectionMeta: CollectionRecoveryMeta | null
  souls: RecoverySoulState[]
}

export type CollectionPublishStatus =
  | 'idle'
  | 'uploading'
  | 'preparing-souls'
  | 'building'
  | 'signing'
  | 'syncing'
  | 'minting-souls'
  | 'binding-souls'
  | 'done'
  | 'error'

export interface CollectionSyncResponse {
  txDigest: string
  collectionOnChainId: string
  rightOnChainId: string
  listingStatus: string
}

interface PublishSyncResponse {
  txDigest: string
  soulOnChainId: string
  stateOnChainId: string
  memoryOnChainId: string
  listingStatus: string
}

/** Soul defined in the batch template — metadata only, files come from soulFolders */
export interface BatchSoulToMint {
  name: string
  description: string
  tags: string[]
  creatorRoyaltyBps: number
}

export interface CollectionPublishParams {
  coverImageFile?: File | null
  name: string
  description: string
  extraRoyaltyBps: number
  tradeable: boolean
  /** Floor price in atomic USDC — minimum listing price for souls in this collection */
  floorPriceAtomic?: string | null
  /** Batch souls to mint and bind to the new collection */
  souls?: BatchSoulToMint[]
  /** Files from numbered subfolders, keyed by 1-indexed folder number */
  soulFolders?: SoulFolderMap
}

export interface CollectionPublishProgress {
  totalSouls: number
  mintedSouls: number
  boundSouls: number
}

function createEmptyRecoveryState(userId: string): RecoveryState {
  return {
    version: RECOVERY_VERSION,
    userId,
    draftSignature: null,
    txDigest: null,
    floorPriceAtomic: null,
    uploadedImageUrl: null,
    collectionData: null,
    collectionMeta: null,
    souls: [],
  }
}

function countMintedSouls(souls: RecoverySoulState[]) {
  return souls.filter((soul) => soul.mintSync).length
}

function countBoundSouls(souls: RecoverySoulState[]) {
  return souls.filter((soul) => soul.bindTxDigest).length
}

function buildRecoverySouls(paramsSouls: BatchSoulToMint[] | undefined, existing: RecoverySoulState[]) {
  if (existing.length > 0) {
    return existing
  }

  return (paramsSouls ?? []).map((input) => ({
    input,
    uploads: null,
    mintDigest: null,
    mintSync: null,
    bindDigest: null,
    bindTxDigest: null,
  }))
}

export function buildCollectionDraftSignature(params: Pick<
  CollectionPublishParams,
  'name' | 'description' | 'extraRoyaltyBps' | 'tradeable' | 'floorPriceAtomic' | 'souls'
>) {
  return JSON.stringify({
    name: params.name.trim(),
    description: params.description.trim(),
    extraRoyaltyBps: params.extraRoyaltyBps,
    tradeable: params.tradeable,
    floorPriceAtomic: params.floorPriceAtomic ?? null,
    souls: (params.souls ?? []).map((soul) => ({
      name: soul.name.trim(),
      description: soul.description.trim(),
      tags: soul.tags,
      creatorRoyaltyBps: soul.creatorRoyaltyBps,
    })),
  })
}

/** Returns true when recovery contains any on-chain digest that cannot be safely discarded. */
function hasCommittedOnChainState(recovery: RecoveryState): boolean {
  if (recovery.txDigest) return true
  return recovery.souls.some((s) => s.mintDigest != null || s.mintSync != null)
}

function sanitizeRecoveryState(raw: string | null, userId: string | undefined): RecoveryState | null {
  if (!raw || !userId) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as RecoveryState
    if (
      parsed.version !== RECOVERY_VERSION
      || parsed.userId !== userId
      || !Array.isArray(parsed.souls)
      || !hasCurrentSoulidityDeploymentSignature(parsed)
    ) {
      return null
    }

    return parsed
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
  const formData = new FormData()
  formData.append('file', withMime(file))
  formData.append('type', type)
  if (sendObjectTo) formData.append('sendObjectTo', sendObjectTo)
  const res = await fetch('/api/souls/upload', { method: 'POST', headers, body: formData })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Upload failed: ${res.status}`)
  }
  return res.json()
}

/** Fallback: auto-generate character file from soul metadata (when no folder files) */
function createCharacterFile(soul: BatchSoulToMint): File {
  const content = `# ${soul.name}\n\n${soul.description}\n`
  const blob = new Blob([content], { type: 'text/markdown' })
  return new File([blob], `${soul.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`, { type: 'text/markdown' })
}

/** Fallback: auto-generate memory file (when no folder files) */
function createMemorySeedFile(soul: BatchSoulToMint): File {
  const content = `${soul.name} memory.\n`
  const blob = new Blob([content], { type: 'text/plain' })
  return new File([blob], 'memory-seed.txt', { type: 'text/plain' })
}

export function useCollectionPublish(draftSignature?: string | null) {
  const suiClient = useSuiClient()
  const [status, setStatus] = useState<CollectionPublishStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const [syncData, setSyncData] = useState<CollectionSyncResponse | null>(null)
  const [progress, setProgress] = useState<CollectionPublishProgress>({ totalSouls: 0, mintedSouls: 0, boundSouls: 0 })
  const { suiWallet, signAndExecute } = usePrivySuiSign()
  const { getAuthHeaders, user } = useAuth()
  const recoveryRef = useRef<RecoveryState | null>(null)
  const uploadedImageUrlRef = useRef<string | null>(null)
  const setRecoveryState = (nextState: RecoveryState | null) => {
    recoveryRef.current = nextState

    try {
      if (!nextState) {
        sessionStorage.removeItem(RECOVERY_KEY)
      } else {
        sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(attachSoulidityDeploymentSignature(nextState)))
      }
    } catch { /* ignore storage failures */ }
  }

  const clearRecoveryState = useCallback(() => {
    recoveryRef.current = null
    uploadedImageUrlRef.current = null
    setTxDigest(null)
    setSyncData(null)
    setProgress({ totalSouls: 0, mintedSouls: 0, boundSouls: 0 })
    setRecoveryState(null)
  }, [])

  // Hydrate recovery state from sessionStorage
  useEffect(() => {
    if (!user?.id) {
      return
    }

    const recovery = sanitizeRecoveryState(sessionStorage.getItem(RECOVERY_KEY), user?.id)
    if (!recovery) {
      clearRecoveryState()
      return
    }

    if (draftSignature && recovery.draftSignature && recovery.draftSignature !== draftSignature) {
      if (hasCommittedOnChainState(recovery)) {
        // On-chain state exists — keep recovery to prevent duplicate mints/collections
        recoveryRef.current = recovery
        uploadedImageUrlRef.current = recovery.uploadedImageUrl
        setTxDigest(recovery.txDigest)
        setSyncData(recovery.collectionData)
        setProgress({
          totalSouls: recovery.souls.length,
          mintedSouls: countMintedSouls(recovery.souls),
          boundSouls: countBoundSouls(recovery.souls),
        })
        return
      }
      clearRecoveryState()
      return
    }

    recoveryRef.current = recovery
    uploadedImageUrlRef.current = recovery.uploadedImageUrl
    setTxDigest(recovery.txDigest)
    setSyncData(recovery.collectionData)
    setProgress({
      totalSouls: recovery.souls.length,
      mintedSouls: countMintedSouls(recovery.souls),
      boundSouls: countBoundSouls(recovery.souls),
    })
  }, [draftSignature, user?.id, clearRecoveryState])

  async function publish(params: CollectionPublishParams) {
    if (!suiWallet) {
      setError('Please sign in first')
      setStatus('error')
      return
    }

    try {
      setError(null)
      const authHeaders = await getAuthHeaders()
      const walletAddress = suiWallet.address
      const currentDraftSignature = buildCollectionDraftSignature(params)
      const hydratedRecovery = recoveryRef.current

      // Block launch when draft changed but on-chain state already committed
      if (hydratedRecovery && hydratedRecovery.draftSignature !== currentDraftSignature && hasCommittedOnChainState(hydratedRecovery)) {
        throw new Error('Collection already committed on-chain. Cannot change metadata after launch has started. Use "Start Over" to abandon the current launch.')
      }

      const baseRecovery = hydratedRecovery && hydratedRecovery.draftSignature === currentDraftSignature
        ? hydratedRecovery
        : createEmptyRecoveryState(user?.id ?? '')

      if (hydratedRecovery && hydratedRecovery.draftSignature !== currentDraftSignature) {
        clearRecoveryState()
      }

      const recovery: RecoveryState = {
        ...baseRecovery,
        userId: user?.id ?? baseRecovery.userId,
        draftSignature: currentDraftSignature,
        floorPriceAtomic: params.floorPriceAtomic ?? baseRecovery.floorPriceAtomic,
        collectionMeta: baseRecovery.collectionMeta ?? {
          name: params.name,
          description: params.description,
          extraRoyaltyBps: params.extraRoyaltyBps,
          tradeable: params.tradeable,
        },
        souls: buildRecoverySouls(params.souls, baseRecovery.souls),
      }

      setRecoveryState(recovery)
      setProgress({
        totalSouls: recovery.souls.length,
        mintedSouls: countMintedSouls(recovery.souls),
        boundSouls: countBoundSouls(recovery.souls),
      })

      // ── Phase 1: Create the collection ──

      let digest = recovery.txDigest
      if (!digest) {
        // Upload cover image
        let imageUrl: string = recovery.uploadedImageUrl ?? ''
        if (!imageUrl) {
          if (!params.coverImageFile) {
            throw new Error('Missing cover image for collection recovery. Restart from Step 1.')
          }
          setStatus('uploading')
          const uploaded = await uploadFile(params.coverImageFile, 'public', authHeaders)
          imageUrl = uploaded.blobUrl
          uploadedImageUrlRef.current = imageUrl
          recovery.uploadedImageUrl = imageUrl
          setRecoveryState({ ...recovery })
        }

        // Resolve kiosk + build TX
        setStatus('building')
        const personalKiosk = await resolvePersonalKiosk(authHeaders, walletAddress)
        await assertObjectInputsExist(suiClient, {
          'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
          'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
        })
        const tx = buildCreateCollectionTx({
          currentKioskId: personalKiosk?.currentKioskId ?? null,
          currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
          name: params.name,
          description: params.description,
          imageUrl,
          extraRoyaltyBps: params.extraRoyaltyBps,
          tradeable: params.tradeable,
        })

        setStatus('signing')
        const result = await signAndExecute(tx)
        digest = result.digest
        setTxDigest(digest)
        recovery.txDigest = result.digest
        setRecoveryState({ ...recovery })
      }

      // Mirror collection
      let collectionData = recovery.collectionData
      if (!collectionData) {
        setStatus('syncing')
        const syncRes = await fetch('/api/collections/create', {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ txDigest: digest, floorPriceAtomic: recovery.floorPriceAtomic }),
        })
        if (!syncRes.ok) {
          const body = await syncRes.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to mirror collection creation')
        }
        collectionData = await syncRes.json()
        recovery.collectionData = collectionData
        setRecoveryState({ ...recovery })
      }
      if (!collectionData) {
        throw new Error('Failed to recover collection sync state')
      }

      // ── Phase 2: Prepare soul uploads before any mint ──

      if (recovery.souls.length > 0) {
        const folders = params.soulFolders ?? new Map()
        const fallbackImageUrl = recovery.uploadedImageUrl ?? uploadedImageUrlRef.current ?? ''
        const missingRecoveredObjectIds = new Set(await findMissingObjectIds(suiClient, recovery.souls.flatMap((soulState) => (
          soulState.uploads
            ? [
                soulState.uploads.protectedBlobObjectId,
                soulState.uploads.foundingMemoryBlobObjectId,
                soulState.uploads.skillsBlobObjectId,
              ]
            : []
        ))))
        if (missingRecoveredObjectIds.size > 0) {
          for (const soulState of recovery.souls) {
            if (!soulState.uploads) continue
            if (
              missingRecoveredObjectIds.has(soulState.uploads.protectedBlobObjectId)
              || missingRecoveredObjectIds.has(soulState.uploads.foundingMemoryBlobObjectId)
              || (soulState.uploads.skillsBlobObjectId && missingRecoveredObjectIds.has(soulState.uploads.skillsBlobObjectId))
            ) {
              soulState.uploads = null
            }
          }
          setRecoveryState({ ...recovery, souls: [...recovery.souls] })
        }

        setStatus('preparing-souls')
        for (let i = 0; i < recovery.souls.length; i++) {
          const soulState = recovery.souls[i]
          if (soulState.uploads) {
            continue
          }

          const folder = folders.get(i + 1)
          const soul = soulState.input
          if (recovery.txDigest && (!folder?.characterFile || !folder?.memoryFile)) {
            throw new Error(`Soul "${soul.name}" is missing local batch files after refresh. Return to Step 2 and re-upload the collection folder before resuming.`)
          }

          // Character file — from folder's soul.md, fallback to auto-generated
          const charFile = folder?.characterFile ?? createCharacterFile(soul)
          const charUpload = await uploadFile(charFile, 'encrypted', authHeaders, walletAddress)
          if (!charUpload.blobObjectId) {
            throw new Error(`Character file upload was deduplicated for Soul "${soul.name}". Please modify the content to make it unique.`)
          }
          if (typeof charUpload.sealDekEnvelope !== 'string' || !charUpload.sealDekEnvelope.trim()) {
            throw new Error(`Character file upload for Soul "${soul.name}" is missing Seal recovery data.`)
          }

          // Memory — from folder's memory.md, fallback to auto-generated
          const memFile = folder?.memoryFile ?? createMemorySeedFile(soul)
          const memUpload = await uploadFile(memFile, 'encrypted', authHeaders, walletAddress)
          if (!memUpload.blobObjectId) {
            throw new Error(`Memory upload was deduplicated for Soul "${soul.name}". Please modify the content to make it unique.`)
          }
          if (typeof memUpload.sealDekEnvelope !== 'string' || !memUpload.sealDekEnvelope.trim()) {
            throw new Error(`Memory upload for Soul "${soul.name}" is missing Seal recovery data.`)
          }

          let skillsBlobObjectId: string | null = null
          let initialSkillName: string | null = null
          let skillsSealDekEnvelope: string | null = null
          if (folder?.skillsFile) {
            const skillsUpload = await uploadFile(folder.skillsFile, 'encrypted', authHeaders, walletAddress)
            if (!skillsUpload.blobObjectId) {
              throw new Error(`Skills bundle upload was deduplicated for Soul "${soul.name}". Please modify the content to make it unique.`)
            }
            if (typeof skillsUpload.sealDekEnvelope !== 'string' || !skillsUpload.sealDekEnvelope.trim()) {
              throw new Error(`Skills bundle upload for Soul "${soul.name}" is missing Seal recovery data.`)
            }
            skillsBlobObjectId = skillsUpload.blobObjectId
            initialSkillName = typeof skillsUpload.skillName === 'string' ? skillsUpload.skillName : null
            skillsSealDekEnvelope = skillsUpload.sealDekEnvelope
          }

          // Image — from folder's image file, fallback to collection cover URL
          let resolvedImageUrl = fallbackImageUrl
          if (folder?.imageFile) {
            const imgUpload = await uploadFile(folder.imageFile, 'public', authHeaders)
            resolvedImageUrl = imgUpload.blobUrl
          }

          soulState.uploads = {
            protectedBlobObjectId: charUpload.blobObjectId,
            sealDekEnvelope: charUpload.sealDekEnvelope,
            foundingMemoryBlobObjectId: memUpload.blobObjectId,
            memorySealDekEnvelope: memUpload.sealDekEnvelope,
            skillsBlobObjectId,
            initialSkillName,
            skillsSealDekEnvelope,
            imageUrl: resolvedImageUrl,
          }
          setRecoveryState({ ...recovery, souls: [...recovery.souls] })
        }

        // ── Phase 3: Mint each soul ──

        setStatus('minting-souls')

        // Resolve kiosk once for all souls
        let personalKiosk = await resolvePersonalKiosk(authHeaders, walletAddress)

        for (let i = 0; i < recovery.souls.length; i++) {
          const soulState = recovery.souls[i]
          const soul = soulState.input
          if (soulState.mintSync) {
            continue
          }
          if (!soulState.uploads) {
            throw new Error(`Soul "${soul.name}" is missing uploaded assets. Restart the collection launch from Step 2.`)
          }

          // Build + sign mint TX (skip if we already have a digest from a previous attempt)
          let mintDigest = soulState.mintDigest
          if (!mintDigest) {
            await assertObjectInputsExist(suiClient, {
              'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
              'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
              'Soul character blob': soulState.uploads.protectedBlobObjectId,
              'Founding memory blob': soulState.uploads.foundingMemoryBlobObjectId,
              'Skills blob': soulState.uploads.skillsBlobObjectId,
            })
            const mintTx = buildPublishSoulTx({
              currentKioskId: personalKiosk?.currentKioskId ?? null,
              currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
              name: soul.name,
              description: soul.description,
              imageUrl: soulState.uploads.imageUrl,
              protectedBlobObjectId: soulState.uploads.protectedBlobObjectId,
              foundingMemoryBlobObjectId: soulState.uploads.foundingMemoryBlobObjectId,
              skillsBlobObjectId: soulState.uploads.skillsBlobObjectId,
              initialSkillName: soulState.uploads.initialSkillName,
              skillsVisibility: 'private',
              creatorRoyaltyBps: soul.creatorRoyaltyBps,
            })
            const mintResult = await signAndExecute(mintTx)
            mintDigest = mintResult.digest

            // Persist digest to recovery BEFORE sync — prevents duplicate mint on retry
            soulState.mintDigest = mintDigest
            setRecoveryState({ ...recovery, souls: [...recovery.souls] })
          }

          // Mirror publish (uses stored or fresh digest)
          const previewImageUrl = soulState.uploads.imageUrl.startsWith('http') ? soulState.uploads.imageUrl : ''
          const publishRes = await fetch('/api/souls/publish', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              txDigest: mintDigest,
              tags: soul.tags,
              previewImages: previewImageUrl ? [previewImageUrl] : [],
              sealSidecar: soulState.uploads.sealDekEnvelope,
              memorySealSidecar: soulState.uploads.memorySealDekEnvelope,
              skillsSealSidecar: soulState.uploads.skillsSealDekEnvelope,
            }),
          })
          if (!publishRes.ok) {
            const body = await publishRes.json().catch(() => ({}))
            throw new Error(body.error || `Failed to mirror Soul "${soul.name}" publish`)
          }

          const publishData: PublishSyncResponse = await publishRes.json()
          soulState.mintSync = publishData
          setRecoveryState({ ...recovery, souls: [...recovery.souls] })
          setProgress((p) => ({ ...p, mintedSouls: countMintedSouls(recovery.souls) }))

          if (!personalKiosk && i === 0) {
            personalKiosk = await resolvePersonalKiosk(authHeaders, walletAddress)
          }
        }

        // ── Phase 4: Bind each minted soul to the collection ──

        setStatus('binding-souls')
        for (let i = 0; i < recovery.souls.length; i++) {
          const soulState = recovery.souls[i]
          if (soulState.bindTxDigest) {
            continue
          }
          if (!soulState.mintSync) {
            throw new Error(`Soul "${soulState.input.name}" was not mirrored after mint. Retry the launch.`)
          }

          // Build + sign bind TX (skip if we already have a digest from a previous attempt)
          let bindDigest = soulState.bindDigest
          if (!bindDigest) {
            const addTx = buildAddSoulToCollectionTx({
              collectionObjectId: collectionData.collectionOnChainId,
              stateObjectId: soulState.mintSync.stateOnChainId,
            })
            const addResult = await signAndExecute(addTx)
            bindDigest = addResult.digest

            // Persist digest to recovery BEFORE mirror — prevents duplicate bind on retry
            soulState.bindDigest = bindDigest
            setRecoveryState({ ...recovery, souls: [...recovery.souls] })
          }

          const addRes = await fetch(`/api/collections/${encodeURIComponent(collectionData.collectionOnChainId)}/add-soul`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ txDigest: bindDigest }),
          })
          if (!addRes.ok) {
            const body = await addRes.json().catch(() => ({}))
            throw new Error(body.error || `Failed to bind Soul "${soulState.input.name}" to collection`)
          }

          soulState.bindTxDigest = bindDigest
          setRecoveryState({ ...recovery, souls: [...recovery.souls] })
          setProgress((p) => ({ ...p, boundSouls: countBoundSouls(recovery.souls) }))
        }
      }

      setSyncData(collectionData)
      setStatus('done')

      uploadedImageUrlRef.current = null
      setRecoveryState(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Collection creation failed')
      setStatus('error')
    }
  }

  return { status, error, txDigest, syncData, progress, publish, suiWallet, resetRecovery: clearRecoveryState }
}
