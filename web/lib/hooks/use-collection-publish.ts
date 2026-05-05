'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import posthog from 'posthog-js'
import type { Transaction } from '@mysten/sui/transactions'
import { Transaction as TransactionCtor } from '@mysten/sui/transactions'
import { useSuiClient } from '@mysten/dapp-kit'
import {
  appendCreateCollectionMoveCalls,
  buildBatchAddSoulToCollectionTx,
  buildCollectionCoverCertifyTx,
} from '@soulidity/sdk'
import {
  buildBatchPublishSoulTx,
  buildCollectionFastPathPtb2Tx,
} from '@soulidity/sdk'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'
import {
  prepareBatchWalrusRegisterIntent,
  completeBatchWalrusUploadAfterRegister,
  type BatchSoulUploadFile,
  type BatchWalrusRegisterIntent,
  type CompleteBatchWalrusUploadResult,
  type SoulUploadResult,
} from '@/lib/upload/client-upload'
import { type PendingSealMaterial } from '@/lib/upload/client-seal'
import { useUploadCostReview } from '@/components/upload/upload-cost-review'
import type { SoulFolderMap } from '@/components/providers/create-collection-provider'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@soulidity/sdk'
import { assertObjectInputsExist } from '@soulidity/sdk'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import {
  extractAllContentVersionAppendedEvents,
  extractAllSoulMintedToKioskEvents,
} from '@soulidity/sdk'
import { assertSoulidityTxSucceeded } from '@soulidity/sdk'
import {
  buildLegacyInitialContent,
  buildLegacyInitialStateConfig,
} from '@soulidity/sdk'
import {
  buildContentSidecarsForVersionsWithSuiClient,
  buildPendingMintSlots,
  KIND_SPRITE,
  type ContentSidecarRequestEntry,
} from '@/lib/hooks/phase2-mint-helpers'

const RECOVERY_KEY = 'collection-mint-recovery'

// v12 — 2-signature fast path (PTB1 register + create [+ list]; PTB2 cover cert
// + N × {mint, bind, finalize_state}). v11 drafts are discarded on hydrate.
const RECOVERY_VERSION = 12 as const

const BATCH_CHUNK_SIZE = 10

const FAST_PATH_BYTES_CAP = (() => {
  const raw = process.env.NEXT_PUBLIC_SOULIDITY_FAST_PATH_BYTES_CAP
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 96_000
})()

const FAST_PATH_GAS_CAP_MIST = (() => {
  const raw = process.env.NEXT_PUBLIC_SOULIDITY_FAST_PATH_GAS_CAP_MIST
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000_000_000
})()

interface SoulUploadRecovery {
  protectedBlobObjectId: string
  sealMaterial: PendingSealMaterial
  foundingMemoryBlobObjectId: string
  memorySealMaterial: PendingSealMaterial
  skillsBlobObjectId: string | null
  initialSkillName: string | null
  skillsSealMaterial: PendingSealMaterial | null
  assetsSealMaterial?: PendingSealMaterial | null
  imageUrl: string
}

interface RecoverySoulState {
  input: BatchSoulToMint
  uploads: SoulUploadRecovery | null
  mintChunkIndex: number
  bindChunkIndex: number
  /** Mirror response for this soul (set after the chunk's mirror call). */
  mintSync: PublishSyncResponse | null
  bindTxDigest: string | null
}

interface CollectionRecoveryMeta {
  name: string
  description: string
  extraRoyaltyBps: number
  tradeable: boolean
  floorPriceAtomic: string | null
  maxSupply: number | null
}

interface ChunkRecovery {
  soulIndices: number[]
  digest: string | null
}

interface FastPathAttempt {
  count: number
  lastError: string | null
}

interface RecoveryState {
  version: typeof RECOVERY_VERSION
  userId: string
  draftSignature: string | null
  /** PTB1 digest: register all blobs + create_collection [+ optional collection-right list]. */
  collectionPtb1Digest: string | null
  /** Set when the cover blob has been certified on-chain (in fastPathPtb2, in
   *  the first chunked mint TX, or as a cover-only PTB2 for empty collections). */
  coverCertifyDigest: string | null
  collectionData: CollectionSyncResponse | null
  /**
   * Collection-right listing intent. When `priceAtomic` is set, PTB1 included
   * `list_collection_right`; the resulting CollectionListed event lives at
   * `collectionPtb1Digest`. `priceAtomic === null` means listing was not
   * requested for this draft.
   */
  collectionRightListing: { priceAtomic: string; includedInPtb1: true } | null
  fastPathPtb2Digest: string | null
  fastPathAttempt: FastPathAttempt | null
  uploadedImageUrl: string | null
  collectionMeta: CollectionRecoveryMeta | null
  souls: RecoverySoulState[]
  mintChunks: ChunkRecovery[]
  bindChunks: ChunkRecovery[]
}

export type CollectionPublishStatus =
  | 'idle'
  | 'uploading'
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
  soulCount?: number
  currentSoulSupply?: number
  maxSoulSupply?: string | null
}

interface PublishSyncResponse {
  txDigest: string
  soulOnChainId: string
  stateOnChainId: string
  memoryOnChainId: string
  listingStatus: string
}

interface PublishSyncBody {
  txDigest: string
  soulOnChainId: string
  tags: string[]
  previewImages: string[]
  contentSidecars: ContentSidecarRequestEntry[]
}

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
  /** On-chain SoulCollection.max_supply. null/undefined = unlimited (Move Option::none). */
  maxSupply?: number | null
  /** Batch souls to mint and bind to the new collection. Empty = empty collection launch. */
  souls?: BatchSoulToMint[]
  soulFolders?: SoulFolderMap
  /**
   * When set, list the collection-right at `priceAtomic` in the SAME PTB as
   * create_collection. The resulting CollectionListed event lives at the
   * PTB1 digest; mirror via `/api/collections/:id/list`.
   */
  collectionRightListing?: { priceAtomic: string } | null
}

export interface CollectionPublishProgress {
  totalSouls: number
  mintedSouls: number
  boundSouls: number
}

class FastPathFallback extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FastPathFallback'
  }
}

class FastPathMirrorFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FastPathMirrorFailed'
  }
}

class FastPathSessionExpired extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FastPathSessionExpired'
  }
}

function chunkSoulIndices(soulCount: number, chunkSize: number): number[][] {
  const chunks: number[][] = []
  for (let i = 0; i < soulCount; i += chunkSize) {
    chunks.push(Array.from({ length: Math.min(chunkSize, soulCount - i) }, (_, j) => i + j))
  }
  return chunks
}

function createEmptyRecoveryState(userId: string): RecoveryState {
  return {
    version: RECOVERY_VERSION,
    userId,
    draftSignature: null,
    collectionPtb1Digest: null,
    coverCertifyDigest: null,
    collectionData: null,
    collectionRightListing: null,
    fastPathPtb2Digest: null,
    fastPathAttempt: null,
    uploadedImageUrl: null,
    collectionMeta: null,
    souls: [],
    mintChunks: [],
    bindChunks: [],
  }
}

function countMintedSouls(souls: RecoverySoulState[]) {
  return souls.filter((soul) => soul.mintSync).length
}

function countBoundSouls(souls: RecoverySoulState[]) {
  return souls.filter((soul) => soul.bindTxDigest).length
}

function buildRecoverySouls(
  paramsSouls: BatchSoulToMint[] | undefined,
  existing: RecoverySoulState[],
): RecoverySoulState[] {
  if (existing.length > 0) {
    return existing
  }
  const souls = paramsSouls ?? []
  const chunkAssignments = souls.map((_, i) => Math.floor(i / BATCH_CHUNK_SIZE))
  return souls.map((input, i) => ({
    input,
    uploads: null,
    mintChunkIndex: chunkAssignments[i],
    bindChunkIndex: chunkAssignments[i],
    mintSync: null,
    bindTxDigest: null,
  }))
}

function buildEmptyChunks(soulCount: number): ChunkRecovery[] {
  return chunkSoulIndices(soulCount, BATCH_CHUNK_SIZE).map((soulIndices) => ({
    soulIndices,
    digest: null,
  }))
}

export function buildCollectionDraftSignature(params: Pick<
  CollectionPublishParams,
  'name' | 'description' | 'extraRoyaltyBps' | 'tradeable' | 'floorPriceAtomic' | 'maxSupply' | 'souls' | 'collectionRightListing'
>) {
  return JSON.stringify({
    name: params.name.trim(),
    description: params.description.trim(),
    extraRoyaltyBps: params.extraRoyaltyBps,
    tradeable: params.tradeable,
    floorPriceAtomic: params.floorPriceAtomic ?? null,
    maxSupply: params.maxSupply ?? null,
    listingPriceAtomic: params.collectionRightListing?.priceAtomic ?? null,
    souls: (params.souls ?? []).map((soul) => ({
      name: soul.name.trim(),
      description: soul.description.trim(),
      tags: soul.tags,
      creatorRoyaltyBps: soul.creatorRoyaltyBps,
    })),
  })
}

function hasCommittedOnChainState(recovery: RecoveryState): boolean {
  if (recovery.collectionPtb1Digest) return true
  if (recovery.fastPathPtb2Digest) return true
  if (recovery.coverCertifyDigest) return true
  if (recovery.mintChunks.some((c) => c.digest != null)) return true
  if (recovery.bindChunks.some((c) => c.digest != null)) return true
  return recovery.souls.some((s) => s.mintSync != null)
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

function hasValidOptionalLegacyAssetsSealMaterial(value: unknown): boolean {
  return value == null || isPendingSealMaterial(value)
}

function sanitizeRecoveryState(raw: string | null, userId: string | undefined): RecoveryState | null {
  if (!raw || !userId) return null
  try {
    const parsed = JSON.parse(raw) as RecoveryState
    // v11 (or earlier) drafts are discarded — schema is incompatible.
    if (parsed.version !== RECOVERY_VERSION) return null
    if (
      parsed.userId !== userId
      || !Array.isArray(parsed.souls)
      || !Array.isArray(parsed.mintChunks)
      || !Array.isArray(parsed.bindChunks)
      || !hasCurrentSoulidityDeploymentSignature(parsed)
    ) {
      return null
    }
    if (parsed.souls.some((soul) => soul.uploads && !hasValidOptionalLegacyAssetsSealMaterial(soul.uploads.assetsSealMaterial))) {
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

function createCharacterFile(soul: BatchSoulToMint): File {
  const content = `# ${soul.name}\n\n${soul.description}\n`
  const blob = new Blob([content], { type: 'text/markdown' })
  return new File([blob], `${soul.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`, { type: 'text/markdown' })
}

function createMemorySeedFile(soul: BatchSoulToMint): File {
  const content = `${soul.name} memory.\n`
  const blob = new Blob([content], { type: 'text/plain' })
  return new File([blob], 'memory-seed.txt', { type: 'text/plain' })
}

interface BatchFileLayout {
  cover: number
  perSoul: Array<{
    char: number
    memory: number
    skills: number | null
    image: number | null
  }>
}

interface BuildBatchPlanResult {
  files: BatchSoulUploadFile[]
  layout: BatchFileLayout
}

function buildBatchUploadPlan(params: {
  coverImageFile: File
  souls: BatchSoulToMint[]
  folders: SoulFolderMap
  walletAddress: string
}): BuildBatchPlanResult {
  const files: BatchSoulUploadFile[] = []
  const perSoul: BatchFileLayout['perSoul'] = []

  const coverIndex = files.length
  files.push({ file: withMime(params.coverImageFile), uploadType: 'public', kind: 'persona-sprite' })

  for (let i = 0; i < params.souls.length; i++) {
    const soul = params.souls[i]
    const folder = params.folders.get(i + 1)

    const charFile = withMime(folder?.characterFile ?? createCharacterFile(soul))
    const charIndex = files.length
    files.push({
      file: charFile,
      uploadType: 'encrypted',
      kind: 'soul-content',
      sendObjectTo: params.walletAddress,
    })

    const memFile = withMime(folder?.memoryFile ?? createMemorySeedFile(soul))
    const memoryIndex = files.length
    files.push({
      file: memFile,
      uploadType: 'encrypted',
      kind: 'soul-content',
      sendObjectTo: params.walletAddress,
    })

    let skillsIndex: number | null = null
    if (folder?.skillsFile) {
      skillsIndex = files.length
      files.push({
        file: withMime(folder.skillsFile),
        uploadType: 'encrypted',
        kind: 'soul-content',
        sendObjectTo: params.walletAddress,
      })
    }

    let imageIndex: number | null = null
    if (folder?.imageFile) {
      imageIndex = files.length
      files.push({
        file: withMime(folder.imageFile),
        uploadType: 'public',
        kind: 'persona-sprite',
      })
    }

    perSoul.push({ char: charIndex, memory: memoryIndex, skills: skillsIndex, image: imageIndex })
  }

  return { files, layout: { cover: coverIndex, perSoul } }
}

function resolveSoulUploadRecovery(
  files: SoulUploadResult[],
  layout: BatchFileLayout,
  soulIndex: number,
  fallbackImageUrl: string,
): SoulUploadRecovery {
  const slot = layout.perSoul[soulIndex]
  if (!slot) {
    throw new Error(`Soul layout slot ${soulIndex} is missing`)
  }
  const charFile = files[slot.char]
  const memFile = files[slot.memory]
  if (!charFile?.blobObjectId || !charFile.sealMaterial) {
    throw new Error(`Soul #${soulIndex + 1} character file is missing blob object id or seal material after upload`)
  }
  if (!memFile?.blobObjectId || !memFile.sealMaterial) {
    throw new Error(`Soul #${soulIndex + 1} memory file is missing blob object id or seal material after upload`)
  }
  let skillsBlobObjectId: string | null = null
  let initialSkillName: string | null = null
  let skillsSealMaterial: PendingSealMaterial | null = null
  if (slot.skills != null) {
    const skillsFile = files[slot.skills]
    if (!skillsFile?.blobObjectId || !skillsFile.sealMaterial) {
      throw new Error(`Soul #${soulIndex + 1} skills bundle is missing blob object id or seal material after upload`)
    }
    skillsBlobObjectId = skillsFile.blobObjectId
    initialSkillName = typeof skillsFile.skillName === 'string' ? skillsFile.skillName : null
    skillsSealMaterial = skillsFile.sealMaterial
  }
  const imageUrl = slot.image != null ? files[slot.image].blobUrl : fallbackImageUrl
  return {
    protectedBlobObjectId: charFile.blobObjectId,
    sealMaterial: charFile.sealMaterial,
    foundingMemoryBlobObjectId: memFile.blobObjectId,
    memorySealMaterial: memFile.sealMaterial,
    skillsBlobObjectId,
    initialSkillName,
    skillsSealMaterial,
    imageUrl,
  }
}

function collectCertifyIndicesForChunk(layout: BatchFileLayout, soulIndices: number[]): number[] {
  const indices: number[] = []
  for (const soulIdx of soulIndices) {
    const slot = layout.perSoul[soulIdx]
    indices.push(slot.char, slot.memory)
    if (slot.skills != null) indices.push(slot.skills)
    if (slot.image != null) indices.push(slot.image)
  }
  return indices
}

async function buildSoulPublishSyncBody(params: {
  txDigest: string
  txResult: unknown
  soul: BatchSoulToMint
  uploads: SoulUploadRecovery
  mintEvent: { soulId: string; contentId: string }
  suiClient: unknown
}): Promise<PublishSyncBody> {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const versionsForSoul = extractAllContentVersionAppendedEvents(params.txResult as never, packageId)
    .filter((version) => version.soulId === params.mintEvent.soulId)
  if (versionsForSoul.length === 0) {
    throw new Error(`Soul "${params.soul.name}" mint transaction is missing ContentVersionAppended events`)
  }
  const legacySpriteVersion = params.uploads.assetsSealMaterial
    ? versionsForSoul.find((version) => version.kind === KIND_SPRITE && version.sealEncrypted) ?? null
    : null

  const contentSidecars = await buildContentSidecarsForVersionsWithSuiClient({
    suiClient: params.suiClient as never,
    packageId,
    contentObjectId: params.mintEvent.contentId,
    pendingByKindName: buildPendingMintSlots({
      soulMaterial: params.uploads.sealMaterial,
      memoryMaterial: params.uploads.memorySealMaterial,
      skillsMaterial: params.uploads.skillsSealMaterial,
      skillsName: params.uploads.initialSkillName,
      spriteMaterial: params.uploads.assetsSealMaterial ?? null,
      spriteName: legacySpriteVersion?.name ?? null,
    }),
    versions: versionsForSoul.map((version) => ({
      kind: version.kind,
      name: version.name,
      versionIndex: version.versionIndex,
      sealEncrypted: version.sealEncrypted,
    })),
  })

  const previewImageUrl = params.uploads.imageUrl.startsWith('http') ? params.uploads.imageUrl : ''
  return {
    txDigest: params.txDigest,
    soulOnChainId: params.mintEvent.soulId,
    tags: params.soul.tags,
    previewImages: previewImageUrl ? [previewImageUrl] : [],
    contentSidecars,
  }
}

async function mirrorFastPathPtb2(args: {
  recovery: RecoveryState
  authHeaders: Record<string, string>
  authoredCollectionData: CollectionSyncResponse
  txResultForMirror: unknown
  ptb2Digest: string
  suiClient: unknown
  persistRecovery: (state: RecoveryState) => void
  updateProgress: (updater: (current: CollectionPublishProgress) => CollectionPublishProgress) => void
}) {
  const {
    recovery,
    authHeaders,
    authoredCollectionData,
    txResultForMirror,
    ptb2Digest,
    suiClient,
    persistRecovery,
    updateProgress,
  } = args
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const mintEvents = extractAllSoulMintedToKioskEvents(txResultForMirror as never, packageId)
  if (mintEvents.length !== recovery.souls.length) {
    throw new FastPathMirrorFailed(
      `fast-path TX produced ${mintEvents.length} mints, expected ${recovery.souls.length}`,
    )
  }
  const syncBodies = []
  for (let i = 0; i < recovery.souls.length; i++) {
    const soul = recovery.souls[i]
    if (!soul.uploads) throw new Error(`Soul "${soul.input.name}" missing uploads at fast-path mirror`)
    const mintEvent = mintEvents[i]
    syncBodies.push(await buildSoulPublishSyncBody({
      txDigest: ptb2Digest,
      txResult: txResultForMirror,
      soul: soul.input,
      uploads: soul.uploads,
      mintEvent,
      suiClient,
    }))
  }
  const batchRes = await fetch('/api/souls/publish/batch', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      txDigest: ptb2Digest,
      collectionOnChainId: authoredCollectionData.collectionOnChainId,
      expectedSoulCount: recovery.souls.length,
      expectedBindCount: recovery.souls.length,
      syncBodies,
    }),
  })
  if (!batchRes.ok) {
    const body = await batchRes.json().catch(() => ({}))
    throw new FastPathMirrorFailed(
      `batch mirror failed: ${
        body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : batchRes.statusText
      }`,
    )
  }
  const batchData = await batchRes.json() as {
    syncs?: Array<{
      soulOnChainId: string
      stateOnChainId: string
      memoryOnChainId: string | null
    }>
  }
  if (!Array.isArray(batchData.syncs) || batchData.syncs.length < recovery.souls.length) {
    throw new FastPathMirrorFailed('Fast-path batch mirror returned fewer syncs than minted souls')
  }
  for (let i = 0; i < recovery.souls.length; i++) {
    const sync = batchData.syncs[i]
    if (!sync.memoryOnChainId) {
      throw new FastPathMirrorFailed(`Fast-path batch mirror missing founding memory for Soul #${i + 1}`)
    }
    recovery.souls[i].mintSync = {
      txDigest: ptb2Digest,
      soulOnChainId: sync.soulOnChainId,
      stateOnChainId: sync.stateOnChainId,
      memoryOnChainId: sync.memoryOnChainId,
      listingStatus: 'unlisted',
    }
    recovery.souls[i].bindTxDigest = ptb2Digest
  }
  persistRecovery({ ...recovery, souls: [...recovery.souls] })
  updateProgress(() => ({
    totalSouls: recovery.souls.length,
    mintedSouls: countMintedSouls(recovery.souls),
    boundSouls: countBoundSouls(recovery.souls),
  }))
}

function installBeforeUnloadGuard(message: string): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: BeforeUnloadEvent) => {
    event.preventDefault()
    event.returnValue = message
    return message
  }
  window.addEventListener('beforeunload', handler)
  return () => window.removeEventListener('beforeunload', handler)
}

export function useCollectionPublish(draftSignature?: string | null) {
  const suiClient = useSuiClient()
  const [status, setStatus] = useState<CollectionPublishStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const [syncData, setSyncData] = useState<CollectionSyncResponse | null>(null)
  const [progress, setProgress] = useState<CollectionPublishProgress>({ totalSouls: 0, mintedSouls: 0, boundSouls: 0 })
  const { suiWallet, signAndExecute } = useWalletSign()
  const { getAuthHeaders, user } = useAuth()
  const { requestUploadCostApproval } = useUploadCostReview()
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

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      const recovery = sanitizeRecoveryState(sessionStorage.getItem(RECOVERY_KEY), user?.id)
      if (!recovery) {
        clearRecoveryState()
        return
      }
      if (draftSignature && recovery.draftSignature && recovery.draftSignature !== draftSignature) {
        if (hasCommittedOnChainState(recovery)) {
          recoveryRef.current = recovery
          uploadedImageUrlRef.current = recovery.uploadedImageUrl
          setTxDigest(recovery.collectionPtb1Digest)
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
      setTxDigest(recovery.collectionPtb1Digest)
      setSyncData(recovery.collectionData)
      setProgress({
        totalSouls: recovery.souls.length,
        mintedSouls: countMintedSouls(recovery.souls),
        boundSouls: countBoundSouls(recovery.souls),
      })
    })
    return () => { cancelled = true }
  }, [draftSignature, user?.id, clearRecoveryState])

  async function publish(params: CollectionPublishParams) {
    if (!suiWallet) {
      setError('Please sign in first')
      setStatus('error')
      return
    }

    const startedAt = Date.now()
    posthog.capture('collection_publish_started', {
      soulCount: params.souls?.length ?? 0,
      maxSupply: params.maxSupply ?? null,
      unlimited: params.maxSupply == null,
      emptyCollection: (params.souls?.length ?? 0) === 0,
      includesListing: !!params.collectionRightListing,
    })

    let removeBeforeUnloadGuard: (() => void) | null = null
    try {
      setError(null)
      const authHeaders = await getAuthHeaders()
      const walletAddress = suiWallet.address
      const currentDraftSignature = buildCollectionDraftSignature(params)
      const hydratedRecovery = recoveryRef.current

      if (hydratedRecovery && hydratedRecovery.draftSignature !== currentDraftSignature && hasCommittedOnChainState(hydratedRecovery)) {
        throw new Error('Collection already committed on-chain. Cannot change metadata after launch has started. Use "Start Over" to abandon the current launch.')
      }

      const baseRecovery = hydratedRecovery && hydratedRecovery.draftSignature === currentDraftSignature
        ? hydratedRecovery
        : createEmptyRecoveryState(user?.id ?? '')

      if (hydratedRecovery && hydratedRecovery.draftSignature !== currentDraftSignature) {
        clearRecoveryState()
      }

      const collectionRightListingPriceAtomic = params.collectionRightListing?.priceAtomic
        ? BigInt(params.collectionRightListing.priceAtomic)
        : null
      if (collectionRightListingPriceAtomic != null && collectionRightListingPriceAtomic <= 0n) {
        throw new Error('collectionRightListing.priceAtomic must be > 0')
      }
      if (collectionRightListingPriceAtomic != null && !params.tradeable) {
        throw new Error('Cannot list a non-tradeable collection right')
      }

      const recovery: RecoveryState = {
        ...baseRecovery,
        userId: user?.id ?? baseRecovery.userId,
        draftSignature: currentDraftSignature,
        collectionMeta: baseRecovery.collectionMeta ?? {
          name: params.name,
          description: params.description,
          extraRoyaltyBps: params.extraRoyaltyBps,
          tradeable: params.tradeable,
          floorPriceAtomic: params.floorPriceAtomic ?? null,
          maxSupply: params.maxSupply ?? null,
        },
        collectionRightListing: collectionRightListingPriceAtomic != null
          ? { priceAtomic: collectionRightListingPriceAtomic.toString(), includedInPtb1: true }
          : baseRecovery.collectionRightListing,
        souls: buildRecoverySouls(params.souls, baseRecovery.souls),
      }
      if (recovery.mintChunks.length === 0) {
        recovery.mintChunks = buildEmptyChunks(recovery.souls.length)
      }
      if (recovery.bindChunks.length === 0) {
        recovery.bindChunks = buildEmptyChunks(recovery.souls.length)
      }

      setRecoveryState(recovery)
      setProgress({
        totalSouls: recovery.souls.length,
        mintedSouls: countMintedSouls(recovery.souls),
        boundSouls: countBoundSouls(recovery.souls),
      })

      // ── Phase 1: Prepare batch walrus register intent (no signature) ──
      // The intent exposes appendRegisterCalls(tx), which we splice into PTB1
      // alongside create_collection.
      let intent: BatchWalrusRegisterIntent | null = null
      let layout: BatchFileLayout | null = null
      let completion: CompleteBatchWalrusUploadResult | null = null

      const needsWalrusIntent = !recovery.collectionPtb1Digest
        || (!recovery.coverCertifyDigest && !recovery.fastPathPtb2Digest)
        || (recovery.souls.length > 0 && recovery.souls.some((s) => {
          const chunk = recovery.mintChunks[s.mintChunkIndex]
          return !s.mintSync && !chunk?.digest && !recovery.fastPathPtb2Digest
        }))

      if (needsWalrusIntent) {
        if (!params.coverImageFile) {
          throw new Error('Missing cover image. Restart the collection launch from Step 1.')
        }
        if (recovery.collectionPtb1Digest && recovery.souls.length > 0) {
          for (let i = 0; i < recovery.souls.length; i++) {
            const folder = params.soulFolders?.get(i + 1)
            const soul = recovery.souls[i]
            const chunk = recovery.mintChunks[soul.mintChunkIndex]
            if (chunk?.digest) continue
            if (!folder?.characterFile || !folder?.memoryFile) {
              throw new Error(
                `Soul "${soul.input.name}" is missing local batch files after refresh. `
                + 'Return to Step 2 and re-upload the collection folder before resuming.',
              )
            }
          }
        }

        setStatus('uploading')
        const plan = buildBatchUploadPlan({
          coverImageFile: params.coverImageFile,
          souls: recovery.souls.map((s) => s.input),
          folders: params.soulFolders ?? new Map(),
          walletAddress,
        })
        intent = await prepareBatchWalrusRegisterIntent({
          files: plan.files,
          walletAddress,
          suiClient,
          confirmQuote: requestUploadCostApproval,
        })
        layout = plan.layout
      }

      // ── Phase 2: PTB1 — register all blobs + create_collection [+ list_collection_right] ──
      if (!recovery.collectionPtb1Digest) {
        if (!intent || !layout) {
          throw new Error('Internal error: walrus register intent missing')
        }
        const personalKiosk = await resolvePersonalKiosk(authHeaders, walletAddress)
        await assertObjectInputsExist(suiClient, {
          'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
          'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
        })

        const coverImageUrl = intent.blobUrls[layout.cover]
        if (!coverImageUrl) {
          throw new Error('Cover image URL missing from register intent')
        }
        recovery.uploadedImageUrl = coverImageUrl
        uploadedImageUrlRef.current = coverImageUrl

        setStatus('building')
        const tx = new TransactionCtor()
        intent.appendRegisterCalls(tx)
        const created = appendCreateCollectionMoveCalls(tx, {
          currentKioskId: personalKiosk?.currentKioskId ?? null,
          currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
          name: params.name,
          description: params.description,
          imageUrl: coverImageUrl,
          extraRoyaltyBps: params.extraRoyaltyBps,
          tradeable: params.tradeable,
          maxSupply: params.maxSupply ?? null,
        })
        if (collectionRightListingPriceAtomic != null) {
          const listing = tx.moveCall({
            target: `${getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')}::market::list_collection_right_fixed_price`,
            arguments: [
              tx.object(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')),
              tx.object(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')),
              created.collection,
              created.personalKiosk.buyerKiosk,
              created.personalKiosk.buyerKioskCap,
              tx.pure.u64(collectionRightListingPriceAtomic),
            ],
          })
          tx.moveCall({
            target: `${getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')}::market::finalize_collection_listing`,
            arguments: [listing],
          })
        }
        created.finalizeCollection()
        created.finalizePersonalKiosk()

        setStatus('signing')
        const result = await signAndExecute(tx)
        const ptb1Digest = result.digest
        assertSoulidityTxSucceeded(result, 'Collection PTB1 (register + create) transaction')
        recovery.collectionPtb1Digest = ptb1Digest
        setTxDigest(ptb1Digest)
        setRecoveryState({ ...recovery })
      }

      // ── Phase 3: Complete walrus upload (sliver upload + cert build) ──
      // Install beforeunload guard for the sliver phase. Uploads can take
      // tens of seconds; closing the tab here orphans the just-paid Blob
      // objects.
      removeBeforeUnloadGuard = installBeforeUnloadGuard(
        'Walrus is uploading slivers for your new collection. Closing this tab now will orphan the registered Blob objects on-chain.',
      )
      if (intent) {
        // Use the live intent (mode='fresh' or 'resume') with the recorded
        // PTB1 digest. Resume mode internally reuses prior register data.
        completion = await completeBatchWalrusUploadAfterRegister({
          intent,
          registerTxDigest: recovery.collectionPtb1Digest,
        })
      }

      // ── Phase 4: Wait PTB1 finality + mirror collection create [+ listing] ──
      if (recovery.collectionPtb1Digest) {
        await suiClient.waitForTransaction({
          digest: recovery.collectionPtb1Digest,
          options: { showEffects: true } as never,
        })
      }

      let collectionData = recovery.collectionData
      if (!collectionData && recovery.collectionPtb1Digest) {
        setStatus('syncing')
        const syncRes = await fetch('/api/collections/create', {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txDigest: recovery.collectionPtb1Digest,
            floorPriceAtomic: recovery.collectionMeta?.floorPriceAtomic ?? null,
          }),
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

      // Mirror the collection-right listing if it was bundled into PTB1.
      if (
        recovery.collectionRightListing
        && recovery.collectionPtb1Digest
        && collectionData.listingStatus !== 'listed'
      ) {
        const listRes = await fetch(
          `/api/collections/${encodeURIComponent(collectionData.collectionOnChainId)}/list`,
          {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ txDigest: recovery.collectionPtb1Digest, action: 'list' }),
          },
        )
        if (!listRes.ok) {
          const body = await listRes.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to mirror collection-right listing')
        }
        const listData = await listRes.json().catch(() => ({})) as { listingStatus?: string }
        collectionData = { ...collectionData, listingStatus: listData.listingStatus ?? collectionData.listingStatus }
        recovery.collectionData = collectionData
        setRecoveryState({ ...recovery })
      }

      // Resolve per-soul upload recovery once PTB1 is finalized.
      if (intent && layout && completion) {
        const fallbackImageUrl = recovery.uploadedImageUrl ?? completion.files[layout.cover]?.blobUrl
        if (!fallbackImageUrl) {
          throw new Error('Cover image URL missing after PTB1 settlement')
        }
        for (let i = 0; i < recovery.souls.length; i++) {
          recovery.souls[i].uploads = resolveSoulUploadRecovery(completion.files, layout, i, fallbackImageUrl)
        }
        setRecoveryState({ ...recovery, souls: [...recovery.souls] })
      }

      // ── Phase 5: Empty-collection branch (cover-only PTB2) ──
      if (recovery.souls.length === 0) {
        if (!recovery.coverCertifyDigest) {
          if (!completion || !layout) {
            throw new Error('Cannot certify cover: walrus completion missing')
          }
          setStatus('building')
          const coverIdx = layout.cover
          const coverTx = await buildCollectionCoverCertifyTx({
            attachCertifyCalls: (tx) => completion!.attachCertifyCalls(tx, [coverIdx]),
          })
          setStatus('signing')
          const coverResult = await signAndExecute(coverTx)
          assertSoulidityTxSucceeded(coverResult, 'Empty collection cover certify transaction')
          recovery.coverCertifyDigest = coverResult.digest
          setRecoveryState({ ...recovery })
        }
        try { completion?.clearBatchRecovery() } catch { /* ignore */ }
        setSyncData(collectionData)
        setStatus('done')
        posthog.capture('collection_publish_completed', {
          soulCount: 0,
          maxSupply: params.maxSupply ?? null,
          unlimited: params.maxSupply == null,
          emptyCollection: true,
          path: 'cover-only',
          elapsedMs: Date.now() - startedAt,
        })
        uploadedImageUrlRef.current = null
        setRecoveryState(null)
        return
      }

      if (recovery.fastPathPtb2Digest && recovery.souls.some((s) => !s.mintSync || !s.bindTxDigest)) {
        setStatus('syncing')
        await mirrorFastPathPtb2({
          recovery,
          authHeaders,
          authoredCollectionData: collectionData,
          txResultForMirror: await suiClient.getTransactionBlock({
            digest: recovery.fastPathPtb2Digest,
            options: { showEvents: true, showObjectChanges: true, showEffects: true, showInput: true } as never,
          }),
          ptb2Digest: recovery.fastPathPtb2Digest,
          suiClient,
          persistRecovery: setRecoveryState,
          updateProgress: setProgress,
        })
        setSyncData(collectionData)
        setStatus('done')
        uploadedImageUrlRef.current = null
        try { completion?.clearBatchRecovery() } catch { /* ignore */ }
        setRecoveryState(null)
        return
      }

      // ── Phase 6: PTB2 fast path (when first attempt and not already failed) ──
      const fastPathBlocked = (recovery.fastPathAttempt?.count ?? 0) >= 1
      if (!recovery.coverCertifyDigest && !fastPathBlocked && completion && layout) {
        try {
          await tryFastPathPtb2({
            recovery,
            completion,
            layout,
            authHeaders,
            walletAddress,
            authoredCollectionData: collectionData,
            params,
            suiClient,
            signAndExecute,
            persistRecovery: setRecoveryState,
            updateProgress: setProgress,
            startedAt,
          })
          // Fast path completed end-to-end; mirror calls already made.
          setSyncData(collectionData)
          setStatus('done')
          uploadedImageUrlRef.current = null
          try { completion.clearBatchRecovery() } catch { /* ignore */ }
          setRecoveryState(null)
          return
        } catch (e) {
          if (e instanceof FastPathSessionExpired) {
            recovery.fastPathPtb2Digest = null
            setRecoveryState({ ...recovery })
            throw e
          }
          if (e instanceof FastPathFallback) {
            recovery.fastPathAttempt = {
              count: (recovery.fastPathAttempt?.count ?? 0) + 1,
              lastError: e.message,
            }
            setRecoveryState({ ...recovery })
            posthog.capture('collection_fast_path_fallback', {
              reason: e.message,
              attempt: recovery.fastPathAttempt.count,
            })
            // fall through to chunked
          } else {
            throw e
          }
        }
      }

      // ── Phase 7: Chunked fallback ──
      setStatus('minting-souls')
      const personalKiosk = await resolvePersonalKiosk(authHeaders, walletAddress)
      await assertObjectInputsExist(suiClient, {
        'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
        'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
      })

      for (let chunkIndex = 0; chunkIndex < recovery.mintChunks.length; chunkIndex++) {
        const chunk = recovery.mintChunks[chunkIndex]
        let chunkDigest = chunk.digest
        let chunkTxResult: unknown | null = null
        const includeCoverCert = !recovery.coverCertifyDigest

        if (!chunkDigest) {
          if (!completion || !layout) {
            throw new Error(
              'Cannot resume mint: blob certificates were lost on refresh. '
              + 'Return to Step 2, re-upload the collection folder, and retry the launch.',
            )
          }
          const blobObjectIds: Record<string, string | null> = {}
          for (const soulIdx of chunk.soulIndices) {
            const uploads = recovery.souls[soulIdx].uploads
            if (!uploads) {
              throw new Error(`Soul "${recovery.souls[soulIdx].input.name}" is missing uploaded assets. Restart from Step 2.`)
            }
            blobObjectIds[`Soul #${soulIdx + 1} character blob`] = uploads.protectedBlobObjectId
            blobObjectIds[`Soul #${soulIdx + 1} memory blob`] = uploads.foundingMemoryBlobObjectId
            if (uploads.skillsBlobObjectId) {
              blobObjectIds[`Soul #${soulIdx + 1} skills blob`] = uploads.skillsBlobObjectId
            }
          }
          blobObjectIds['Your personal kiosk'] = personalKiosk?.currentKioskId ?? null
          blobObjectIds['Your personal kiosk capability'] = personalKiosk?.currentKioskCapOnChainId ?? null
          await assertObjectInputsExist(suiClient, blobObjectIds)

          const chunkCertIndices = collectCertifyIndicesForChunk(layout, chunk.soulIndices)
          const certIndices = includeCoverCert
            ? [layout.cover, ...chunkCertIndices]
            : chunkCertIndices
          const completionLocal = completion
          const tx = await buildBatchPublishSoulTx({
            currentKioskId: personalKiosk?.currentKioskId ?? null,
            currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
            souls: chunk.soulIndices.map((soulIdx) => {
              const soul = recovery.souls[soulIdx]
              const uploads = soul.uploads
              if (!uploads) {
                throw new Error(`Soul "${soul.input.name}" is missing uploaded assets`)
              }
              return {
                name: soul.input.name,
                description: soul.input.description,
                imageUrl: uploads.imageUrl,
                initialContent: buildLegacyInitialContent({
                  protectedBlobObjectId: uploads.protectedBlobObjectId,
                  foundingMemoryBlobObjectId: uploads.foundingMemoryBlobObjectId,
                  skillsBlobObjectId: uploads.skillsBlobObjectId,
                  initialSkillName: uploads.initialSkillName,
                  skillsVisibility: 'private',
                }),
                initialStateConfig: buildLegacyInitialStateConfig({
                  protectedBlobObjectId: uploads.protectedBlobObjectId,
                }),
                creatorRoyaltyBps: soul.input.creatorRoyaltyBps,
              }
            }),
            attachBeforeMints: (mintTx: Transaction) => completionLocal.attachCertifyCalls(mintTx, certIndices),
          })
          const mintResult = await signAndExecute(tx)
          chunkDigest = mintResult.digest
          chunkTxResult = mintResult
          assertSoulidityTxSucceeded(mintResult, 'Collection batch mint transaction')

          chunk.digest = chunkDigest
          if (includeCoverCert) {
            recovery.coverCertifyDigest = chunkDigest
          }
          setRecoveryState({ ...recovery, mintChunks: [...recovery.mintChunks] })
        }

        if (!chunkDigest) {
          throw new Error('Mint chunk digest is missing after sign')
        }

        // Mirror via /api/souls/publish/batch — one RPC per chunk regardless of N.
        // We still need per-soul contentSidecars, so we resolve the events from
        // the chunk TX and build syncBodies in JS.
        const chunkNeedsMirror = chunk.soulIndices.some((idx) => !recovery.souls[idx].mintSync)
        if (chunkNeedsMirror) {
          if (!chunkTxResult) {
            chunkTxResult = await suiClient.getTransactionBlock({
              digest: chunkDigest,
              options: { showEvents: true, showObjectChanges: true, showEffects: true, showInput: true } as never,
            })
          }
          const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
          const mintEvents = extractAllSoulMintedToKioskEvents(chunkTxResult as never, packageId)
          if (mintEvents.length !== chunk.soulIndices.length) {
            throw new Error(
              `Batch mint chunk produced ${mintEvents.length} mint events but expected ${chunk.soulIndices.length}`,
            )
          }

          const syncBodies = []
          for (let i = 0; i < chunk.soulIndices.length; i++) {
            const soulIdx = chunk.soulIndices[i]
            const soul = recovery.souls[soulIdx]
            const mintEvent = mintEvents[i]
            if (!soul.uploads) {
              throw new Error(`Soul "${soul.input.name}" is missing uploaded assets during mirror sync`)
            }
            syncBodies.push(await buildSoulPublishSyncBody({
              txDigest: chunkDigest,
              txResult: chunkTxResult,
              soul: soul.input,
              uploads: soul.uploads,
              mintEvent,
              suiClient,
            }))
          }
          const batchRes = await fetch('/api/souls/publish/batch', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              txDigest: chunkDigest,
              collectionOnChainId: collectionData.collectionOnChainId,
              expectedSoulCount: chunk.soulIndices.length,
              expectedBindCount: 0,
              syncBodies,
            }),
          })
          if (!batchRes.ok) {
            const body = await batchRes.json().catch(() => ({}))
            throw new Error(body.error || 'Failed to mirror chunked publish batch')
          }
          const batchData = await batchRes.json() as {
            syncs?: Array<{
              soulOnChainId: string
              stateOnChainId: string
              memoryOnChainId: string | null
            }>
          }
          if (!Array.isArray(batchData.syncs) || batchData.syncs.length < chunk.soulIndices.length) {
            throw new Error('Chunked publish batch mirror returned fewer syncs than minted souls')
          }
          for (let i = 0; i < chunk.soulIndices.length; i++) {
            const soulIdx = chunk.soulIndices[i]
            const sync = batchData.syncs[i]
            if (!sync?.memoryOnChainId) {
              throw new Error(`Chunked publish batch mirror missing founding memory for Soul #${soulIdx + 1}`)
            }
            recovery.souls[soulIdx].mintSync = {
              txDigest: chunkDigest,
              soulOnChainId: sync.soulOnChainId,
              stateOnChainId: sync.stateOnChainId,
              memoryOnChainId: sync.memoryOnChainId,
              listingStatus: 'unlisted',
            }
          }
          setRecoveryState({ ...recovery, souls: [...recovery.souls] })
          setProgress((p) => ({ ...p, mintedSouls: countMintedSouls(recovery.souls) }))
        }
      }

      // ── Phase 8: Chunked bind ──
      setStatus('binding-souls')
      for (let chunkIndex = 0; chunkIndex < recovery.bindChunks.length; chunkIndex++) {
        const chunk = recovery.bindChunks[chunkIndex]
        let chunkDigest = chunk.digest

        if (!chunkDigest) {
          const stateIds: string[] = []
          for (const soulIdx of chunk.soulIndices) {
            const soul = recovery.souls[soulIdx]
            if (!soul.mintSync) {
              throw new Error(`Soul "${soul.input.name}" was not mirrored after mint. Retry the launch.`)
            }
            stateIds.push(soul.mintSync.stateOnChainId)
          }
          const tx = buildBatchAddSoulToCollectionTx({
            collectionObjectId: collectionData.collectionOnChainId,
            binds: stateIds.map((stateObjectId) => ({ stateObjectId })),
          })
          const addResult = await signAndExecute(tx)
          chunkDigest = addResult.digest
          assertSoulidityTxSucceeded(addResult, 'Collection batch bind transaction')
          chunk.digest = chunkDigest
          setRecoveryState({ ...recovery, bindChunks: [...recovery.bindChunks] })
        }

        if (!chunkDigest) {
          throw new Error('Bind chunk digest is missing after sign')
        }

        for (const soulIdx of chunk.soulIndices) {
          const soul = recovery.souls[soulIdx]
          if (soul.bindTxDigest) continue
          if (!soul.mintSync) {
            throw new Error(`Soul "${soul.input.name}" mint mirror missing during bind sync`)
          }
          const addRes = await fetch(`/api/collections/${encodeURIComponent(collectionData.collectionOnChainId)}/add-soul`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              txDigest: chunkDigest,
              soulOnChainId: soul.mintSync.soulOnChainId,
            }),
          })
          if (!addRes.ok) {
            const body = await addRes.json().catch(() => ({}))
            throw new Error(body.error || `Failed to bind Soul "${soul.input.name}" to collection`)
          }
          soul.bindTxDigest = chunkDigest
          setRecoveryState({ ...recovery, souls: [...recovery.souls] })
          setProgress((p) => ({ ...p, boundSouls: countBoundSouls(recovery.souls) }))
        }
      }

      setSyncData(collectionData)
      setStatus('done')
      posthog.capture('collection_publish_completed', {
        soulCount: params.souls?.length ?? 0,
        maxSupply: params.maxSupply ?? null,
        unlimited: params.maxSupply == null,
        emptyCollection: false,
        path: 'chunked',
        elapsedMs: Date.now() - startedAt,
      })

      try { completion?.clearBatchRecovery() } catch { /* ignore */ }
      uploadedImageUrlRef.current = null
      setRecoveryState(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Collection creation failed')
      setStatus('error')
      posthog.captureException(
        err instanceof Error ? err : new Error(String(err)),
        {
          scope: 'collection_publish',
          phase: status,
          soulCount: params.souls?.length ?? 0,
          elapsedMs: Date.now() - startedAt,
        },
      )
    } finally {
      removeBeforeUnloadGuard?.()
    }
  }

  return { status, error, txDigest, syncData, progress, publish, suiWallet, resetRecovery: clearRecoveryState }
}

async function tryFastPathPtb2(args: {
  recovery: RecoveryState
  completion: CompleteBatchWalrusUploadResult
  layout: BatchFileLayout
  authHeaders: Record<string, string>
  walletAddress: string
  authoredCollectionData: CollectionSyncResponse
  params: CollectionPublishParams
  suiClient: ReturnType<typeof useSuiClient>
  signAndExecute: ReturnType<typeof useWalletSign>['signAndExecute']
  persistRecovery: (recovery: RecoveryState | null) => void
  updateProgress: (updater: (p: CollectionPublishProgress) => CollectionPublishProgress) => void
  startedAt: number
}) {
  const { recovery, completion, layout, authHeaders, walletAddress, authoredCollectionData, suiClient, signAndExecute, persistRecovery, startedAt } = args

  const personalKiosk = await resolvePersonalKiosk(authHeaders, walletAddress)
  await assertObjectInputsExist(suiClient, {
    'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
    'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
  })

  const allSoulIndices = recovery.souls.map((_, i) => i)
  const certIndices = [layout.cover, ...collectCertifyIndicesForChunk(layout, allSoulIndices)]

  const tx = await buildCollectionFastPathPtb2Tx({
    collectionOnChainId: authoredCollectionData.collectionOnChainId,
    currentKioskId: personalKiosk?.currentKioskId ?? null,
    currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
    souls: recovery.souls.map((soul) => {
      const uploads = soul.uploads
      if (!uploads) throw new Error(`Soul "${soul.input.name}" is missing uploaded assets`)
      return {
        name: soul.input.name,
        description: soul.input.description,
        imageUrl: uploads.imageUrl,
        initialContent: buildLegacyInitialContent({
          protectedBlobObjectId: uploads.protectedBlobObjectId,
          foundingMemoryBlobObjectId: uploads.foundingMemoryBlobObjectId,
          skillsBlobObjectId: uploads.skillsBlobObjectId,
          initialSkillName: uploads.initialSkillName,
          skillsVisibility: 'private',
        }),
        initialStateConfig: buildLegacyInitialStateConfig({
          protectedBlobObjectId: uploads.protectedBlobObjectId,
        }),
        creatorRoyaltyBps: soul.input.creatorRoyaltyBps,
      }
    }),
    attachCertifyCalls: (ptb) => completion.attachCertifyCalls(ptb, certIndices),
  })

  tx.setSender(walletAddress)
  const bytes = await tx.build({ client: suiClient as never, onlyTransactionKind: false })

  const dryRun = await suiClient.dryRunTransactionBlock({ transactionBlock: bytes })
  if (dryRun.effects.status.status !== 'success') {
    const errMsg = dryRun.effects.status.error || 'Unknown dry-run failure'
    if (/missing object|changed object|not exist|version/i.test(errMsg)) {
      throw new FastPathSessionExpired(`Session expired (${errMsg}); please retry from the start`)
    }
    throw new FastPathFallback(`dry-run failed: ${errMsg}`)
  }
  if (bytes.length > FAST_PATH_BYTES_CAP) {
    throw new FastPathFallback(`bytes ${bytes.length} > cap ${FAST_PATH_BYTES_CAP}`)
  }
  const computation = Number(dryRun.effects.gasUsed.computationCost)
  const storage = Number(dryRun.effects.gasUsed.storageCost)
  if (computation + storage > FAST_PATH_GAS_CAP_MIST) {
    throw new FastPathFallback(`gas ${computation + storage} > cap ${FAST_PATH_GAS_CAP_MIST}`)
  }

  let result
  try {
    result = await signAndExecute(tx)
  } catch (error) {
    throw new FastPathFallback(
      `signAndExecute failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const ptb2Digest = result.digest
  if (result.effects?.status?.status !== 'success') {
    throw new FastPathFallback('signAndExecute returned failure status')
  }
  recovery.fastPathPtb2Digest = ptb2Digest
  recovery.coverCertifyDigest = ptb2Digest
  for (const chunk of recovery.mintChunks) {
    chunk.digest = ptb2Digest
  }
  for (const chunk of recovery.bindChunks) {
    chunk.digest = ptb2Digest
  }
  persistRecovery({ ...recovery })

  // Mirror via /api/souls/publish/batch — one RPC for the whole digest.
  await mirrorFastPathPtb2({
    recovery,
    authHeaders,
    authoredCollectionData,
    txResultForMirror: result,
    ptb2Digest,
    suiClient,
    persistRecovery,
    updateProgress: args.updateProgress,
  })

  posthog.capture('collection_publish_completed', {
    soulCount: recovery.souls.length,
    maxSupply: args.params.maxSupply ?? null,
    unlimited: args.params.maxSupply == null,
    emptyCollection: false,
    path: 'fast',
    elapsedMs: Date.now() - startedAt,
  })
}

// Re-exported for legacy callers — used by tests + the upload helper to detect
// material mismatches across legacy/new mint flows.
export type { SoulUploadResult }
