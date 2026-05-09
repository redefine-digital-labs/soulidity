'use client'

import { Transaction } from '@mysten/sui/transactions'
import { inferSoulUploadContentType } from '@/lib/upload/content-type'
import {
  buildWalrusUploadPlan,
  isWalrusUploadQuoteFresh,
  quoteWalrusUpload,
  type WalrusUploadPlan,
  type WalrusUploadQuote,
} from '@soulidity/sdk'
import { encryptClientSide, sha256Hex, type PendingSealMaterial } from '@/lib/upload/client-seal'
import {
  extractSkillBundleMetadata,
  hasZipSignature,
  validateSoulUploadFile,
  validateSoulUploadSignature,
} from '@soulidity/sdk'
import {
  buildWalrusBatchRecoveryKey,
  buildWalrusUploadRecoveryKey,
  clearWalrusBatchRecovery,
  clearWalrusUploadRecovery,
  persistWalrusBatchRecovery,
  persistWalrusUploadRecovery,
  readWalrusBatchRecovery,
  readWalrusUploadRecovery,
  WalrusUploadResumeMismatchError,
  type WalrusBatchRecoveryBlob,
  type WalrusOrphanBlob,
  type WalrusUploadRecoveryRecord,
} from '@/lib/upload/walrus-recovery'
import { assertSuiTxSucceeded } from '@soulidity/sdk'
import {
  deserializeWalrusCertificate,
  getConfiguredWalrusUploadTransport,
  serializeWalrusEncodedBlob,
  type SerializedWalrusCertificate,
  type WalrusUploadTransport,
} from '@/lib/upload/walrus-batch-transport'
import {
  completeManagedWalrusUpload,
  finalizeManagedWalrusUpload,
  requestManagedWalrusUploaderCredentials,
  uploadPayloadToManagedWalrusUploader,
  type ManagedUploaderCredentials,
} from '@/lib/upload/walrus-managed-transport'

export type SoulUploadKind = 'persona-sprite' | 'soul-content'
export type SoulUploadType = 'public' | 'encrypted'

export interface SoulUploadResult {
  blobId: string
  blobObjectId: string
  contentHash: string
  blobUrl: string
  sealMaterial?: PendingSealMaterial | null
  skillName?: string | null
  storageTxDigest: string
  certifyTxDigest: string
  quoteId: string
}

export type SignAndExecuteWalrusTx = (tx: Transaction) => Promise<{
  digest: string
  effects?: { status?: { status?: string; error?: string } }
}>

/**
 * Thrown when the user declines the upload-cost review modal. Treated as an
 * intentional control-flow signal — callers should NOT report it as a frontend
 * exception (it is not an app failure).
 */
export class WalrusUploadCancelledError extends Error {
  constructor(message = 'Walrus upload was cancelled before wallet signing') {
    super(message)
    this.name = 'WalrusUploadCancelledError'
  }
}

export interface UploadSoulPayloadParams {
  file: File
  uploadType: SoulUploadType
  kind: SoulUploadKind
  authHeaders?: Record<string, string>
  sendObjectTo?: string | null
  walletAddress: string
  suiClient: unknown
  signAndExecute: SignAndExecuteWalrusTx
  confirmQuote: (quote: WalrusUploadQuote) => Promise<boolean>
  storageEpochs?: number
  // Only skill-bundle uploads must contain `SKILL.md`; sprite ZIPs (and other
  // ZIP-shaped payloads such as cover archives) do not. Default false so a
  // generic ZIP upload no longer fails the skill-bundle parser.
  extractSkillMetadata?: boolean
}

interface UploadBlobResult {
  blobId: string
  blobObjectId: string
  storageTxDigest: string
  certifyTxDigest: string
}

interface SuiClientWithCache {
  cache?: {
    clear?: (prefix?: string | string[]) => void
  }
}

// 26 mainnet epochs × 14 days/epoch = 364 days ≈ 12 months. Comfortably under
// the mainnet `max_epochs_ahead` cap (≈53). On testnet (1 day/epoch) this is
// 26 days, which is fine for testing.
const DEFAULT_STORAGE_EPOCHS = 26
const DEFAULT_TESTNET_RELAY_URL = 'https://upload-relay.testnet.walrus.space'
const DEFAULT_MAINNET_RELAY_URL = 'https://upload-relay.mainnet.walrus.space'
const DEFAULT_TESTNET_AGGREGATOR_URL = 'https://aggregator.walrus-testnet.walrus.space'
const DEFAULT_MAINNET_AGGREGATOR_URL = 'https://aggregator.mainnet.walrus.mirai.cloud'
const QUOTE_RELAY_TIP_MAX_MIST = BigInt(Number.MAX_SAFE_INTEGER)
const WALRUS_WEIGHTED_QUORUM_CONFIRMATION_RETRIES = 2
const WALRUS_STORAGE_WRITE_TIMEOUT_MS = 20_000
const WALRUS_REGISTER_RESOLVE_TIMEOUT_MS = 60_000
const DEFAULT_MANAGED_COMPLETE_CONCURRENCY = 1
const MIN_MANAGED_COMPLETE_CONCURRENCY = 1
const MAX_MANAGED_COMPLETE_CONCURRENCY = 4

function getWalrusWasmUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_WALRUS_WASM_URL
  if (explicit && explicit.length > 0) return explicit
  // next.config injects NEXT_PUBLIC_WALRUS_WASM_VERSION from the installed
  // @mysten/walrus-wasm package, and `npm run predev` / `prebuild` copies the
  // matching .wasm into web/public/walrus/ so we serve it from our own origin
  // pinned to the installed version. This avoids depending on a mutable
  // `unpkg.com/@latest` asset that can drift from the linked SDK.
  const version = process.env.NEXT_PUBLIC_WALRUS_WASM_VERSION
  if (!version || version.length === 0) {
    throw new Error(
      'Walrus WASM asset is not available: NEXT_PUBLIC_WALRUS_WASM_VERSION is missing. '
      + 'Run `npm --prefix web run copy-walrus-wasm` and rebuild, or set NEXT_PUBLIC_WALRUS_WASM_URL.',
    )
  }
  return `/walrus/walrus_wasm@${version}.wasm`
}

function getWalrusNetwork(): 'testnet' | 'mainnet' {
  return process.env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
}

function getUploadRelayUrl(network: 'testnet' | 'mainnet') {
  return (
    process.env.NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL
    ?? (network === 'mainnet' ? DEFAULT_MAINNET_RELAY_URL : DEFAULT_TESTNET_RELAY_URL)
  ).replace(/\/+$/, '')
}

function getAggregatorUrl(network: 'testnet' | 'mainnet') {
  return (
    process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL
    ?? (network === 'mainnet' ? DEFAULT_MAINNET_AGGREGATOR_URL : DEFAULT_TESTNET_AGGREGATOR_URL)
  ).replace(/\/+$/, '')
}

function getBlobUrl(blobId: string, network: 'testnet' | 'mainnet') {
  return `${getAggregatorUrl(network)}/v1/blobs/${encodeURIComponent(blobId)}`
}

function getManagedCompleteConcurrency(): number {
  const raw = process.env.NEXT_PUBLIC_WALRUS_MANAGED_COMPLETE_CONCURRENCY?.trim()
  if (!raw) return DEFAULT_MANAGED_COMPLETE_CONCURRENCY

  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) return DEFAULT_MANAGED_COMPLETE_CONCURRENCY

  return Math.max(
    MIN_MANAGED_COMPLETE_CONCURRENCY,
    Math.min(MAX_MANAGED_COMPLETE_CONCURRENCY, parsed),
  )
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  let failed = false

  async function runWorker(): Promise<void> {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      try {
        results[index] = await worker(items[index] as T, index)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  )
  return results
}

function cloneBytes(bytes: Uint8Array) {
  return new Uint8Array(bytes)
}

function clearWalrusUploadRelayTipCache(suiClient: unknown) {
  const cache = (suiClient as SuiClientWithCache).cache
  if (cache?.clear) {
    cache.clear([
      '@mysten/walrus',
      'upload-relay-tip-config',
    ])
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export function hasWalrusWeightedQuorum(params: {
  signerWeights: readonly number[]
  nShards: number
}): boolean {
  if (!Number.isFinite(params.nShards) || params.nShards <= 0) return false
  const weight = params.signerWeights.reduce((sum, value) => {
    if (!Number.isFinite(value) || value <= 0) return sum
    return sum + Math.trunc(value)
  }, 0)
  return 3 * weight >= 2 * Math.trunc(params.nShards) + 1
}

async function createWalrusClient(params: {
  suiClient: unknown
  network: 'testnet' | 'mainnet'
  relayUrl?: string
  maxRelayTipMist?: bigint
}) {
  const { WalrusClient } = await import('@mysten/walrus')
  if (!params.relayUrl) {
    return new WalrusClient({
      suiClient: params.suiClient as never,
      network: params.network,
      wasmUrl: getWalrusWasmUrl(),
    })
  }
  clearWalrusUploadRelayTipCache(params.suiClient)
  const maxTip = (params.maxRelayTipMist ?? 0n) > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(params.maxRelayTipMist ?? 0n)
  return new WalrusClient({
    suiClient: params.suiClient as never,
    network: params.network,
    wasmUrl: getWalrusWasmUrl(),
    uploadRelay: {
      host: params.relayUrl,
      sendTip: { max: Math.max(maxTip, 0) },
    },
  })
}

type WalrusClientInstance = Awaited<ReturnType<typeof createWalrusClient>>
type WalrusCertificate = Awaited<ReturnType<WalrusClientInstance['certificateFromConfirmations']>>
type WalrusConfirmations = Parameters<WalrusClientInstance['certificateFromConfirmations']>[0]['confirmations']
type WalrusSystemState = Awaited<ReturnType<WalrusClientInstance['systemState']>>

function getWalrusSignerWeights(params: {
  signers: readonly number[]
  committeeMembers: WalrusSystemState['committee']['members']
}): number[] {
  const seen = new Set<number>()
  const weights: number[] = []
  for (const signer of params.signers) {
    if (!Number.isInteger(signer) || signer < 0 || seen.has(signer)) continue
    seen.add(signer)
    const weight = params.committeeMembers[signer]?.weight
    weights.push(Number.isFinite(weight) && weight > 0 ? Math.trunc(weight) : 0)
  }
  return weights
}

function getWalrusCertificateQuorumStatus(params: {
  certificate: WalrusCertificate
  systemState: WalrusSystemState
}) {
  const nShards = Math.trunc(params.systemState.committee.n_shards)
  const signerWeights = getWalrusSignerWeights({
    signers: params.certificate.signers,
    committeeMembers: params.systemState.committee.members,
  })
  const signingWeight = signerWeights.reduce((sum, value) => sum + value, 0)
  return {
    hasQuorum: hasWalrusWeightedQuorum({ signerWeights, nShards }),
    signingWeight,
    nShards,
  }
}

async function uploadSingleBlob(params: {
  client: Awaited<ReturnType<typeof createWalrusClient>>
  payload: Uint8Array
  walletAddress: string
  storageEpochs: number
  signAndExecute: SignAndExecuteWalrusTx
  recoveryKey: string
  contentHash: string
  network: 'testnet' | 'mainnet'
}) {
  const existing = readWalrusUploadRecovery(params.recoveryKey)
  const matchesExisting = (record: WalrusUploadRecoveryRecord | null) =>
    !!record
    && record.walletAddress.toLowerCase() === params.walletAddress.toLowerCase()
    && record.network === params.network
    && record.payloadByteLength === params.payload.byteLength
    && record.storageEpochs === params.storageEpochs
  const resumeRecord = matchesExisting(existing) ? existing : null
  if (existing && !resumeRecord) {
    // Different upload intent under the same key — drop stale state.
    clearWalrusUploadRecovery(params.recoveryKey)
  }

  // The SDK's runtime resume reads `blobId`, `blobObjectId`, `txDigest`, and
  // `nonce` independently (see @mysten/walrus/dist/flows/write-blob.mjs). The
  // public `WriteBlobStep` discriminated union additionally requires a `step`
  // field plus `rootHash`/`unencodedSize`/`certificate` that we don't persist;
  // we cast through `unknown` because runtime only consumes the four fields
  // we provide here.
  type WriteBlobFlowOptionsArg = Parameters<typeof params.client.writeBlobFlow>[0]
  type ResumeOption = NonNullable<WriteBlobFlowOptionsArg['resume']>
  const flow = params.client.writeBlobFlow({
    blob: params.payload,
    ...(resumeRecord
      ? {
          resume: {
            blobId: resumeRecord.blobId,
            ...(resumeRecord.blobObjectId ? { blobObjectId: resumeRecord.blobObjectId } : {}),
            txDigest: resumeRecord.txDigest,
            ...(resumeRecord.nonce ? { nonce: resumeRecord.nonce } : {}),
          } as unknown as ResumeOption,
        }
      : {}),
  })

  let encoded: Awaited<ReturnType<typeof flow.encode>>
  try {
    encoded = await flow.encode()
  } catch (encodeError) {
    if (resumeRecord) {
      clearWalrusUploadRecovery(params.recoveryKey)
      throw new WalrusUploadResumeMismatchError({
        message:
          'Cannot resume the previous Walrus upload because the payload changed. '
          + `A previously registered Blob object (${resumeRecord.blobObjectId ?? 'object id unknown'}) `
          + `from tx ${resumeRecord.txDigest} is now orphaned and will not be reused. `
          + 'Original error: '
          + (encodeError instanceof Error ? encodeError.message : String(encodeError)),
        orphanBlobs: [{ blobId: resumeRecord.blobId, blobObjectId: resumeRecord.blobObjectId }],
        orphanTxDigest: resumeRecord.txDigest,
      })
    }
    throw encodeError
  }

  let txDigest: string
  let deletable = true
  if (resumeRecord) {
    txDigest = resumeRecord.txDigest
    deletable = resumeRecord.deletable
  } else {
    const registerTx = flow.register({
      epochs: params.storageEpochs,
      owner: params.walletAddress,
      deletable,
    })
    const registerResult = await params.signAndExecute(registerTx)
    try {
      assertSuiTxSucceeded(registerResult, 'Walrus register transaction')
    } catch (error) {
      clearWalrusUploadRecovery(params.recoveryKey)
      throw error
    }
    txDigest = registerResult.digest
    // Persist the registered blob immediately so a relay/certify failure does
    // not silently re-register on the next attempt and burn another wallet
    // payment. blobObjectId is filled in after `flow.upload` resolves it.
    persistWalrusUploadRecovery(params.recoveryKey, {
      walletAddress: params.walletAddress,
      network: params.network,
      contentHash: params.contentHash,
      payloadByteLength: params.payload.byteLength,
      storageEpochs: params.storageEpochs,
      blobId: encoded.blobId,
      blobObjectId: null,
      txDigest,
      nonce: 'nonce' in encoded && typeof encoded.nonce === 'string' ? encoded.nonce : null,
      deletable,
    })
  }

  const uploaded = await flow.upload({ digest: txDigest, deletable })

  // We now know the on-chain Blob object id; refresh recovery so a later
  // certify failure can resume without re-resolving the digest.
  if (uploaded.blobObjectId) {
    persistWalrusUploadRecovery(params.recoveryKey, {
      walletAddress: params.walletAddress,
      network: params.network,
      contentHash: params.contentHash,
      payloadByteLength: params.payload.byteLength,
      storageEpochs: params.storageEpochs,
      blobId: uploaded.blobId,
      blobObjectId: uploaded.blobObjectId,
      txDigest,
      nonce: 'nonce' in encoded && typeof encoded.nonce === 'string' ? encoded.nonce : null,
      deletable,
    })
  }

  const certifyTx = flow.certify()
  const certifyResult = await params.signAndExecute(certifyTx)
  assertSuiTxSucceeded(certifyResult, 'Walrus certify transaction')
  const certified = await flow.getBlob()

  // Successful end-to-end run — recovery is no longer needed.
  clearWalrusUploadRecovery(params.recoveryKey)

  return {
    blobId: certified.blobId,
    blobObjectId: certified.blobObjectId || uploaded.blobObjectId,
    storageTxDigest: txDigest,
    certifyTxDigest: certifyResult.digest,
  }
}

async function uploadPayloadToWalrus(params: {
  name: string
  contentHash: string
  payload: Uint8Array
  walletAddress: string
  suiClient: unknown
  signAndExecute: SignAndExecuteWalrusTx
  storageEpochs: number
  plan: WalrusUploadPlan
  quote: WalrusUploadQuote
  network: 'testnet' | 'mainnet'
  relayUrl: string
  payloadHash: string
}): Promise<UploadBlobResult> {
  void params.name
  void params.contentHash
  void params.plan
  const client = await createWalrusClient({
    suiClient: params.suiClient,
    network: params.network,
    relayUrl: params.relayUrl,
    maxRelayTipMist: params.quote.relayTipMist,
  })

  const recoveryKey = buildWalrusUploadRecoveryKey({
    network: params.network,
    walletAddress: params.walletAddress,
    contentHash: params.payloadHash,
    payloadByteLength: params.payload.byteLength,
    storageEpochs: params.storageEpochs,
  })

  return uploadSingleBlob({
    client,
    payload: params.payload,
    walletAddress: params.walletAddress,
    storageEpochs: params.storageEpochs,
    signAndExecute: params.signAndExecute,
    recoveryKey,
    contentHash: params.payloadHash,
    network: params.network,
  })
}

// ---------------------------------------------------------------------------
// Batch publish path: one PTB1 (register all) + parallel HTTP uploads + one
// PTB2 (certify all + mint), so N files cost 2 wallet signatures regardless
// of N. The mint half is composed by the caller via `attachCertifyCalls(tx)`.
// ---------------------------------------------------------------------------

export interface BatchSoulUploadFile {
  file: File
  uploadType: SoulUploadType
  kind: SoulUploadKind
  /** Optional override; defaults to walletAddress. Each blob can be transferred to a different recipient. */
  sendObjectTo?: string | null
  // Only skill-bundle uploads must contain `SKILL.md`; sprite ZIPs (and other
  // ZIP-shaped payloads) do not. Default false so a generic ZIP upload no
  // longer fails the skill-bundle parser.
  extractSkillMetadata?: boolean
}

export interface PreparedSoulBlobs {
  /** One result per input file, in the same order as `params.files`. */
  files: SoulUploadResult[]
  /** Digest of PTB1 (the register transaction). */
  registerTxDigest: string
  /**
   * Splices `certify_blob` calls into the caller's mint PTB. Must be called
   * before signing the PTB. When `indices` is omitted, certifies every file
   * in the batch (legacy single-mint path). When provided, only certifies the
   * specified subset — used by the collection-publish flow which splits
   * certifies across multiple downstream PTBs (one for create_collection,
   * one per chunked mint batch). Each blob can only be certified once on
   * chain, so the caller is responsible for ensuring every index appears in
   * exactly one `attachCertifyCalls` invocation.
   */
  attachCertifyCalls: (tx: Transaction, indices?: ReadonlyArray<number>) => Promise<void>
  /**
   * MUST be invoked by the caller after the certify+mint PTB executes successfully.
   * Drops the persisted register-recovery state so the next publish does not try
   * to resume / surface a now-stale orphan record.
   */
  clearBatchRecovery: () => void
}

export interface PrepareSoulBlobsForBatchPublishParams {
  files: BatchSoulUploadFile[]
  walletAddress: string
  suiClient: unknown
  signAndExecute: SignAndExecuteWalrusTx
  confirmQuote: (quote: WalrusUploadQuote) => Promise<boolean>
  authHeaders?: Record<string, string>
  transport?: WalrusUploadTransport
  storageEpochs?: number
}

// ---------------------------------------------------------------------------
// 3-phase batch helper:
//   1. prepareBatchWalrusRegisterIntent        — validate, encrypt, encode,
//      compute blob URLs, build the cost quote, and expose
//      `appendRegisterCalls(tx)` for the caller to splice into PTB1
//      (alongside e.g. collection creation calls). No wallet signature yet.
//   2. completeBatchWalrusUploadAfterRegister  — accept the signed PTB1
//      digest, persist batch recovery, resolve Blob object ids, upload
//      slivers, build certificates, and return `files` +
//      `attachCertifyCalls(tx, indices)` + `clearBatchRecovery()`.
//   3. prepareSoulBlobsForBatchPublish         — thin wrapper over (1)+(2)
//      for callers that still want the legacy single-step shape.
//
// Resume semantics (matching recovery, blobIds line up):
//   intent.mode === 'resume', appendRegisterCalls is a no-op,
//   intent.resumedRegisterTxDigest carries the prior register digest, and
//   complete() reuses the recovered Blob object ids without writing PTB1.
// ---------------------------------------------------------------------------

export interface BatchWalrusRegisterIntent {
  mode: 'fresh' | 'resume'
  fileCount: number
  /** Stable blob URLs derived from each file's blobId (no signature needed). */
  blobUrls: string[]
  /** sha256 of plaintext per file (no signature needed). */
  contentHashes: string[]
  /** Skill bundle metadata per file (null if not a skill bundle). */
  skillBundleMetadata: Array<ReturnType<typeof extractSkillBundleMetadata> | null>
  /** Aggregate cost quote already approved by the user. */
  quote: WalrusUploadQuote
  /**
   * Prior register tx digest when `mode === 'resume'`; null otherwise. The
   * resume path skips PTB1 and reuses these Blob objects for cert + mint.
   */
  resumedRegisterTxDigest: string | null
  /**
   * Splices N `client.registerBlob(...)` + N `tx.transferObjects(...)` calls
   * into the caller's PTB1. No-op when `mode === 'resume'`. Idempotent across
   * different `Transaction` instances (calling with two different tx objects
   * produces structurally identical command sequences).
   */
  appendRegisterCalls: (tx: Transaction) => void
  /**
   * Internal continuation state consumed by
   * `completeBatchWalrusUploadAfterRegister`. Treat as opaque.
   */
  readonly __continuation: BatchWalrusContinuation
}

interface BatchWalrusContinuation {
  network: 'testnet' | 'mainnet'
  walletAddress: string
  storageEpochs: number
  suiClient: unknown
  walrusClient: Awaited<ReturnType<typeof createWalrusClient>>
  transport: WalrusUploadTransport
  prepared: PreparedFile[]
  encodedList: Array<{
    uploadId?: string | null
    blobId: string
    rootHash: Uint8Array
    size?: number
    metadata?: Parameters<Awaited<ReturnType<typeof createWalrusClient>>['writeEncodedBlobToNodes']>[0]['metadata']
    sliversByNode?: Parameters<Awaited<ReturnType<typeof createWalrusClient>>['writeEncodedBlobToNodes']>[0]['sliversByNode']
  }>
  managedUploader: ManagedUploaderCredentials | null
  recoveryKey: string
  resumedBlobObjectIds: string[] | null
  quote: WalrusUploadQuote
}

export interface CompleteBatchWalrusUploadAfterRegisterParams {
  intent: BatchWalrusRegisterIntent
  /**
   * Digest of the PTB containing the register calls. When the intent is in
   * `'resume'` mode, this is ignored — the prior digest is used. When in
   * `'fresh'` mode, this is required.
   */
  registerTxDigest?: string | null
  authHeaders?: Record<string, string>
  transport?: WalrusUploadTransport
}

export interface CompleteBatchWalrusUploadResult {
  files: SoulUploadResult[]
  registerTxDigest: string
  attachCertifyCalls: (tx: Transaction, indices?: ReadonlyArray<number>) => Promise<void>
  clearBatchRecovery: () => void
}

export interface PrepareBatchWalrusRegisterIntentParams {
  files: BatchSoulUploadFile[]
  walletAddress: string
  suiClient: unknown
  confirmQuote: (quote: WalrusUploadQuote) => Promise<boolean>
  authHeaders?: Record<string, string>
  transport?: WalrusUploadTransport
  storageEpochs?: number
}

interface PreparedFile {
  index: number
  item: BatchSoulUploadFile
  contentType: string
  normalizedFile: File
  plaintext: Uint8Array
  payload: Uint8Array
  encrypted: Awaited<ReturnType<typeof encryptClientSide>> | null
  contentHash: string
  skillBundleMetadata: ReturnType<typeof extractSkillBundleMetadata> | null
}

interface ReadFileResult {
  plaintext: Uint8Array
  contentHash: string
  contentType: string
  normalizedFile: File
}

async function readAndHashUploadFile(item: BatchSoulUploadFile): Promise<ReadFileResult> {
  const contentType = inferSoulUploadContentType(item.file, item.uploadType)
  const normalizedFile =
    item.file.type === contentType
      ? item.file
      : new File([item.file], item.file.name, { type: contentType })
  const fileError = validateSoulUploadFile(normalizedFile, item.uploadType)
  if (fileError) throw new Error(fileError)
  const plaintext = new Uint8Array(await normalizedFile.arrayBuffer())
  const signatureError = validateSoulUploadSignature(plaintext, item.uploadType, contentType)
  if (signatureError) throw new Error(signatureError)
  const contentHash = await sha256Hex(plaintext)
  return { plaintext, contentHash, contentType, normalizedFile }
}

async function preparePayload(
  item: BatchSoulUploadFile,
  index: number,
  base: ReadFileResult,
  /**
   * Optional persisted DEK/IV for this slot. When provided AND the file's
   * content hash still matches, the encryption reuses the prior key/IV so the
   * Walrus blobId is byte-identical to the prior attempt. This is how a
   * partially-paid PTB1 register can resume on the next page load instead of
   * tripping `WalrusUploadResumeMismatchError`.
   */
  materialOverride?: PendingSealMaterial | null,
): Promise<PreparedFile> {
  const skillBundleMetadata = item.extractSkillMetadata && hasZipSignature(base.plaintext)
    ? extractSkillBundleMetadata(base.plaintext)
    : null
  // Only reuse the persisted material when the plaintext fingerprint still
  // matches — guards against the user swapping the file under the same draft
  // key (different bytes, same recovery slot).
  const reusableMaterial =
    materialOverride && materialOverride.contentHash === base.contentHash
      ? materialOverride
      : null
  const encrypted =
    item.uploadType === 'encrypted'
      ? await encryptClientSide({
          plaintext: base.plaintext,
          mimeType: base.contentType,
          fileName: base.normalizedFile.name || 'bundle',
          material: reusableMaterial,
        })
      : null
  const payload = encrypted ? encrypted.ciphertext : base.plaintext
  return {
    index,
    item,
    contentType: base.contentType,
    normalizedFile: base.normalizedFile,
    plaintext: base.plaintext,
    payload,
    encrypted,
    contentHash: base.contentHash,
    skillBundleMetadata,
  }
}

interface SuiClientForBlobLookup {
  waitForTransaction: (args: { digest: string; timeout?: number }) => Promise<unknown>
  getTransactionBlock: (args: {
    digest: string
    options: { showObjectChanges: boolean; showEffects: boolean }
  }) => Promise<{
    objectChanges?: Array<{
      type?: string
      objectType?: string
      objectId?: string
    }> | null
  }>
}

/**
 * Map each expected SDK blobId to its on-chain object id by inspecting the
 * register PTB's objectChanges, then re-querying each created Blob via
 * WalrusClient.getBlobObject.
 *
 * Two format gotchas worth pinning down:
 *  - Walrus's `Blob` struct is non-generic (`<pkg>::blob::Blob`, no type
 *    params), so the objectType match must be exact, not a `::Blob<` substring.
 *  - The on-chain `blob_id` field is `u256` (returned as a decimal string from
 *    `getBlobObject`), while the SDK's blobId is the BCS-serialized
 *    little-endian u256 in URL-safe base64. We convert via `blobIdFromInt` so
 *    map keys align with `computeBlobMetadata`'s output.
 */
async function resolveCreatedBlobObjectIds(params: {
  suiClient: unknown
  walrusClient: {
    getBlobObject: (id: string) => Promise<{ id: string; blob_id: string }>
    getBlobType: () => string | Promise<string>
  }
  digest: string
  expectedBlobIds: string[]
}): Promise<string[]> {
  const { blobIdFromInt } = await import('@mysten/walrus')
  const client = params.suiClient as SuiClientForBlobLookup
  const expectedBlobType = await params.walrusClient.getBlobType()
  await withTimeout(
    client.waitForTransaction({ digest: params.digest, timeout: WALRUS_REGISTER_RESOLVE_TIMEOUT_MS }),
    WALRUS_REGISTER_RESOLVE_TIMEOUT_MS + 5_000,
    `Timed out resolving Walrus register transaction ${params.digest}`,
  )
  const tx = await withTimeout(
    client.getTransactionBlock({
      digest: params.digest,
      options: { showObjectChanges: true, showEffects: true },
    }),
    WALRUS_REGISTER_RESOLVE_TIMEOUT_MS,
    `Timed out reading Walrus register transaction ${params.digest}`,
  )
  const createdBlobObjectIds: string[] = []
  for (const change of tx.objectChanges ?? []) {
    if (
      change.type === 'created'
      && typeof change.objectType === 'string'
      && change.objectType === expectedBlobType
      && typeof change.objectId === 'string'
    ) {
      createdBlobObjectIds.push(change.objectId)
    }
  }
  if (createdBlobObjectIds.length < params.expectedBlobIds.length) {
    throw new Error(
      `Register transaction created ${createdBlobObjectIds.length} Blob objects but `
      + `${params.expectedBlobIds.length} were expected. Digest: ${params.digest}`,
    )
  }
  const decoded = await withTimeout(
    Promise.all(
      createdBlobObjectIds.map((objectId) => params.walrusClient.getBlobObject(objectId)),
    ),
    WALRUS_REGISTER_RESOLVE_TIMEOUT_MS,
    `Timed out decoding Walrus Blob objects for register transaction ${params.digest}`,
  )
  // Use a per-blobId queue rather than `Map<string, string>` so duplicate
  // expected blobIds (e.g. the same public payload reused as both cover image
  // and persona sprite) consume distinct created Blob objects instead of
  // collapsing onto whichever decode happened last.
  const objectIdsByBlobId = new Map<string, string[]>()
  for (const blob of decoded) {
    const sdkBlobId = blobIdFromInt(BigInt(blob.blob_id))
    const queue = objectIdsByBlobId.get(sdkBlobId)
    if (queue) {
      queue.push(blob.id)
    } else {
      objectIdsByBlobId.set(sdkBlobId, [blob.id])
    }
  }
  return params.expectedBlobIds.map((blobId) => {
    const queue = objectIdsByBlobId.get(blobId)
    const objectId = queue?.shift()
    if (!objectId) {
      throw new Error(
        `Register transaction did not produce a Blob object for blobId ${blobId}. Digest: ${params.digest}`,
      )
    }
    return objectId
  })
}

async function writeEncodedBlobAndBuildCertificate(params: {
  client: Awaited<ReturnType<typeof createWalrusClient>>
  blobId: string
  blobObjectId: string
  metadata: Parameters<Awaited<ReturnType<typeof createWalrusClient>>['writeEncodedBlobToNodes']>[0]['metadata']
  sliversByNode: Parameters<Awaited<ReturnType<typeof createWalrusClient>>['writeEncodedBlobToNodes']>[0]['sliversByNode']
  deletable: boolean
}) {
  const getStorageConfirmations = () =>
    withTimeout(
      params.client.getStorageConfirmations({
        blobId: params.blobId,
        objectId: params.blobObjectId,
        deletable: params.deletable,
      }),
      WALRUS_STORAGE_WRITE_TIMEOUT_MS,
      `Timed out fetching Walrus storage confirmations for blobId ${params.blobId} objectId ${params.blobObjectId}`,
    )
  let confirmations: Awaited<ReturnType<typeof params.client.writeEncodedBlobToNodes>>
  let writeError: unknown = null
  try {
    confirmations = await withTimeout(
      params.client.writeEncodedBlobToNodes({
        blobId: params.blobId,
        objectId: params.blobObjectId,
        metadata: params.metadata,
        sliversByNode: params.sliversByNode,
        deletable: params.deletable,
      }),
      WALRUS_STORAGE_WRITE_TIMEOUT_MS,
      `Timed out writing Walrus slivers for blobId ${params.blobId} objectId ${params.blobObjectId}`,
    )
  } catch (error) {
    writeError = error
    confirmations = await getStorageConfirmations()
  }

  let lastQuorumStatus: ReturnType<typeof getWalrusCertificateQuorumStatus> | null = null
  for (let attempt = 0; attempt <= WALRUS_WEIGHTED_QUORUM_CONFIRMATION_RETRIES; attempt++) {
    let certificate: WalrusCertificate
    try {
      certificate = await params.client.certificateFromConfirmations({
        confirmations,
        blobId: params.blobId,
        blobObjectId: params.blobObjectId,
        deletable: params.deletable,
      })
    } catch (certificateError) {
      if (writeError) throw writeError
      throw certificateError
    }

    const systemState = await params.client.systemState()
    const quorumStatus = getWalrusCertificateQuorumStatus({ certificate, systemState })
    if (quorumStatus.hasQuorum) {
      return {
        blobId: params.blobId,
        blobObjectId: params.blobObjectId,
        certificate,
      }
    }
    lastQuorumStatus = quorumStatus
    if (attempt === WALRUS_WEIGHTED_QUORUM_CONFIRMATION_RETRIES) break

    confirmations = await getStorageConfirmations()
  }

  if (lastQuorumStatus) {
    throw new Error(
      'Walrus certificate weighted quorum pre-signing guard rejected '
      + `blobId ${params.blobId} objectId ${params.blobObjectId}: `
      + `signing weight ${lastQuorumStatus.signingWeight} did not satisfy `
      + `n_shards ${lastQuorumStatus.nShards}`,
    )
  }

  throw new Error(
    `Walrus certificate weighted quorum pre-signing guard could not evaluate blobId ${params.blobId} objectId ${params.blobObjectId}`,
  )
}

function isSerializedWalrusCertificate(value: unknown): value is SerializedWalrusCertificate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SerializedWalrusCertificate>
  return Array.isArray(candidate.signers)
    && candidate.signers.every((signer) => Number.isInteger(signer) && signer >= 0)
    && typeof candidate.serializedMessage === 'string'
    && typeof candidate.signature === 'string'
}

async function completeEncodedBlobsViaServer(params: {
  network: 'testnet' | 'mainnet'
  walletAddress: string
  registerTxDigest: string
  encodedList: BatchWalrusContinuation['encodedList']
  blobObjectIds: string[]
  authHeaders?: Record<string, string>
}): Promise<Array<{
  blobId: string
  blobObjectId: string
  certificate: WalrusCertificate
}>> {
  const body = {
    network: params.network,
    registerTxDigest: params.registerTxDigest,
    walletAddress: params.walletAddress,
    blobs: params.encodedList.map((encoded, index) =>
      serializeWalrusEncodedBlob({
        blobId: encoded.blobId,
        blobObjectId: params.blobObjectIds[index],
        metadata: encoded.metadata,
        sliversByNode: encoded.sliversByNode,
      }),
    ),
  }

  const response = await fetch('/api/walrus/batch/complete', {
    method: 'POST',
    headers: {
      ...params.authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null) as {
    error?: string
    files?: Array<{
      blobId?: unknown
      blobObjectId?: unknown
      certificate?: unknown
    }>
  } | null

  if (!response.ok) {
    throw new Error(payload?.error || `Walrus server upload failed with HTTP ${response.status}`)
  }

  if (!payload || !Array.isArray(payload.files) || payload.files.length !== params.encodedList.length) {
    throw new Error('Walrus server upload returned an invalid certificate list')
  }

  return payload.files.map((file, index) => {
    const expected = params.encodedList[index]
    const expectedObjectId = params.blobObjectIds[index]
    if (file.blobId !== expected.blobId || file.blobObjectId !== expectedObjectId) {
      throw new Error(`Walrus server upload returned mismatched certificate for blob index ${index}`)
    }
    if (!isSerializedWalrusCertificate(file.certificate)) {
      throw new Error(`Walrus server upload returned an invalid certificate for blob index ${index}`)
    }
    return {
      blobId: expected.blobId,
      blobObjectId: expectedObjectId,
      certificate: deserializeWalrusCertificate(file.certificate) as WalrusCertificate,
    }
  })
}

function requireManagedUploadId(
  encoded: BatchWalrusContinuation['encodedList'][number],
  index: number,
): string {
  if (!encoded.uploadId) {
    throw new Error(`Walrus managed upload missing uploadId for blob index ${index}`)
  }
  return encoded.uploadId
}

function requireBrowserEncodedBlob(
  encoded: BatchWalrusContinuation['encodedList'][number],
  index: number,
): {
  metadata: NonNullable<BatchWalrusContinuation['encodedList'][number]['metadata']>
  sliversByNode: NonNullable<BatchWalrusContinuation['encodedList'][number]['sliversByNode']>
} {
  if (encoded.metadata == null || encoded.sliversByNode == null) {
    throw new Error(
      `Walrus ${encoded.uploadId ? 'managed' : 'browser'} upload cannot use local/server sliver completion for blob index ${index}`,
    )
  }
  return {
    metadata: encoded.metadata,
    sliversByNode: encoded.sliversByNode,
  }
}

async function completeEncodedBlobsViaManagedUploader(params: {
  credentials: ManagedUploaderCredentials
  network: 'testnet' | 'mainnet'
  walletAddress: string
  registerTxDigest: string
  encodedList: BatchWalrusContinuation['encodedList']
  blobObjectIds: string[]
}): Promise<Array<{
  blobId: string
  blobObjectId: string
  certificate: WalrusCertificate
}>> {
  return mapWithConcurrency(
    params.encodedList,
    getManagedCompleteConcurrency(),
    async (encoded, index) => {
      const uploadId = requireManagedUploadId(encoded, index)
      const blobObjectId = params.blobObjectIds[index]
      const completed = await completeManagedWalrusUpload({
        credentials: params.credentials,
        uploadId,
        walletAddress: params.walletAddress,
        network: params.network,
        registerTxDigest: params.registerTxDigest,
        blobObjectId,
      })
      if (completed.blobId !== encoded.blobId || completed.blobObjectId !== blobObjectId) {
        throw new Error(`Walrus uploader returned mismatched completion for blob index ${index}`)
      }
      return {
        blobId: completed.blobId,
        blobObjectId: completed.blobObjectId,
        certificate: completed.certificate as WalrusCertificate,
      }
    },
  )
}

export async function reclaimWalrusOrphanBlobs(params: {
  orphanBlobs: ReadonlyArray<WalrusOrphanBlob>
  walletAddress: string
  suiClient: unknown
  signAndExecute: SignAndExecuteWalrusTx
}): Promise<{ digest: string; reclaimedCount: number }> {
  const blobObjectIds = Array.from(new Set(
    params.orphanBlobs
      .map((blob) => blob.blobObjectId)
      .filter((blobObjectId): blobObjectId is string => !!blobObjectId),
  ))
  if (blobObjectIds.length === 0) {
    throw new Error('No reclaimable Walrus Blob object ids were found for the stale batch.')
  }

  const client = await createWalrusClient({
    suiClient: params.suiClient,
    network: getWalrusNetwork(),
  })
  const tx = new Transaction()
  tx.setSenderIfNotSet(params.walletAddress)
  for (const blobObjectId of blobObjectIds) {
    const storage = tx.add(client.deleteBlob({ blobObjectId }))
    tx.transferObjects([storage], params.walletAddress)
  }

  const result = await params.signAndExecute(tx)
  assertSuiTxSucceeded(result, 'Walrus orphan reclaim transaction')

  return {
    digest: result.digest,
    reclaimedCount: blobObjectIds.length,
  }
}

function buildAggregateUploadPlan(prepared: PreparedFile[], network: 'testnet' | 'mainnet', storageEpochs: number, relayUrl: string) {
  return buildWalrusUploadPlan({
    files: prepared.map((p) => ({
      name: p.normalizedFile.name || p.item.kind,
      size: p.plaintext.byteLength,
      encryptedSize: p.payload.byteLength,
    })),
    network,
    storageEpochs,
    chunking: false,
    relayUrl,
    // Batch path: PTB1 bundles N register_blob calls; PTB2 bundles N
    // certify_blob calls + the mint move call. The wallet sees exactly two
    // signature prompts regardless of N. Override the per-blob default so the
    // cost-review modal and gas-budget default match reality.
    walletSignatureCount: 2,
  })
}

export async function prepareBatchWalrusRegisterIntent(
  params: PrepareBatchWalrusRegisterIntentParams,
): Promise<BatchWalrusRegisterIntent> {
  if (params.files.length === 0) {
    throw new Error('At least one file is required for a batch Soul publish')
  }

  const network = getWalrusNetwork()
  const relayUrl = getUploadRelayUrl(network)
  const storageEpochs = params.storageEpochs ?? DEFAULT_STORAGE_EPOCHS
  const transport = params.transport ?? getConfiguredWalrusUploadTransport()

  // 1a. Read + hash every file in parallel (no encryption yet) so we can
  //     look up any prior recovery record keyed on `(contentHash,
  //     sendObjectTo)` BEFORE generating fresh AES-GCM keys. When a matching
  //     record carries persisted DEK/IV for an encrypted slot, the next step
  //     reuses that material so the resulting ciphertext (and therefore the
  //     Walrus blobId) is byte-identical to the prior attempt. Without this,
  //     a tab/browser/machine death between PTB1 sign and certify would
  //     re-encrypt with a fresh key, bake a different blobId, and strand the
  //     already-paid Blob objects via `WalrusUploadResumeMismatchError`.
  const baseFiles = await Promise.all(params.files.map(readAndHashUploadFile))

  const lookupRecoveryKey = await buildWalrusBatchRecoveryKey({
    network,
    walletAddress: params.walletAddress,
    storageEpochs,
    files: baseFiles.map((h, i) => ({
      contentHash: h.contentHash,
      sendObjectTo: params.files[i].sendObjectTo?.trim() || params.walletAddress,
    })),
  })
  const priorRecovery = readWalrusBatchRecovery(lookupRecoveryKey)
  const priorMatches =
    !!priorRecovery
    && priorRecovery.walletAddress.toLowerCase() === params.walletAddress.toLowerCase()
    && priorRecovery.network === network
    && priorRecovery.storageEpochs === storageEpochs
    && priorRecovery.blobs.length === params.files.length
    && priorRecovery.blobs.every((b, i) => b.contentHash === baseFiles[i].contentHash)
  const materialOverrides: Array<PendingSealMaterial | null> = params.files.map((item, i) => {
    if (!priorMatches || !priorRecovery) return null
    if (item.uploadType !== 'encrypted') return null
    const rec = priorRecovery.blobs[i]
    return rec?.sealMaterial ?? null
  })

  // 1b. Encrypt (with cached material when available) and finalise prepared
  //     state in parallel.
  const prepared = await Promise.all(
    params.files.map((item, index) =>
      preparePayload(item, index, baseFiles[index], materialOverrides[index]),
    ),
  )

  // 2. Build a single aggregate quote.
  //
  // Batch path bypasses the upload relay (the relay server validates the auth
  // payload at `ptb.inputs.first()`, which only fits one auth payload per
  // PTB). Direct storage-node uploads have no PTB-shape constraint; we encode
  // each blob client-side and write slivers directly. Relay tip is 0n. The
  // user-facing cost confirmation happens after the recovery decision below:
  // fresh uploads must confirm before PTB1, while resume reuses already-paid
  // Blob objects and must not ask the user to approve the same storage again.
  const plan = buildAggregateUploadPlan(prepared, network, storageEpochs, relayUrl)
  const quoteClient = await createWalrusClient({
    suiClient: params.suiClient,
    network,
  })
  const quote = await quoteWalrusUpload(plan, {
    fetchStorageCost: (payloadBytes, epochs) => quoteClient.storageCost(payloadBytes, epochs),
    calculateRelayTip: async () => 0n,
  })

  const preUploadRecoveryKey = await buildWalrusBatchRecoveryKey({
    network,
    walletAddress: params.walletAddress,
    storageEpochs,
    files: prepared.map((p) => ({
      contentHash: p.contentHash,
      sendObjectTo: p.item.sendObjectTo?.trim() || params.walletAddress,
    })),
  })
  const preUploadRecovery = readWalrusBatchRecovery(preUploadRecoveryKey)
  const preUploadMayResume =
    !!preUploadRecovery
    && preUploadRecovery.walletAddress.toLowerCase() === params.walletAddress.toLowerCase()
    && preUploadRecovery.network === network
    && preUploadRecovery.storageEpochs === storageEpochs
    && preUploadRecovery.blobs.length === prepared.length

  let quoteApprovedBeforeUpload = false
  if (transport === 'managed' && !preUploadMayResume) {
    const approved = await params.confirmQuote(quote)
    if (!approved) {
      throw new WalrusUploadCancelledError('Walrus upload was cancelled before wallet signing')
    }
    if (!isWalrusUploadQuoteFresh(quote, plan)) {
      throw new Error('Walrus upload quote expired before wallet signing')
    }
    quoteApprovedBeforeUpload = true
  }

  // 3. Encode every blob. The managed path sends only encrypted payload bytes
  // to the uploader service; it never ships Walrus slivers through Vercel.
  const client = quoteClient
  const managedUploader = transport === 'managed'
    ? await requestManagedWalrusUploaderCredentials({
        walletAddress: params.walletAddress,
        network,
        fileCount: prepared.length,
        byteLimit: prepared.reduce((sum, p) => sum + p.payload.byteLength, 0),
        authHeaders: params.authHeaders,
      })
    : null
  const encodedList = transport === 'managed'
    ? await Promise.all(prepared.map(async (p) => {
        const uploaded = await uploadPayloadToManagedWalrusUploader({
          credentials: managedUploader!,
          walletAddress: params.walletAddress,
          network,
          payload: p.payload,
          fileName: p.normalizedFile.name || p.item.kind,
        })
        return {
          uploadId: uploaded.uploadId,
          blobId: uploaded.blobId,
          rootHash: uploaded.rootHash,
          size: uploaded.size,
        }
      }))
    : await Promise.all(
        prepared.map((p) => client.encodeBlob(p.payload)),
      )

  // 3a. Batch recovery — same orphan / resume / fresh decision tree as
  // before. We freeze it here (pre-signature) so the caller's PTB1 either
  // skips register (resume) or appends register (fresh). On orphan-mismatch
  // we throw before any signature.
  const recoveryKey = await buildWalrusBatchRecoveryKey({
    network,
    walletAddress: params.walletAddress,
    storageEpochs,
    files: prepared.map((p) => ({
      contentHash: p.contentHash,
      sendObjectTo: p.item.sendObjectTo?.trim() || params.walletAddress,
    })),
  })
  const existingRecovery = readWalrusBatchRecovery(recoveryKey)
  const intentMatches = (record: ReturnType<typeof readWalrusBatchRecovery>): boolean =>
    !!record
    && record.walletAddress.toLowerCase() === params.walletAddress.toLowerCase()
    && record.network === network
    && record.storageEpochs === storageEpochs
    && record.blobs.length === prepared.length
  const matchingRecovery = intentMatches(existingRecovery) ? existingRecovery : null
  if (existingRecovery && !matchingRecovery) {
    clearWalrusBatchRecovery(recoveryKey)
  }

  const blobIdsMatch =
    matchingRecovery
    && matchingRecovery.blobs.every(
      (b, i) =>
        b.blobId === encodedList[i].blobId
        && b.payloadByteLength === prepared[i].payload.byteLength,
    )

  // Re-derive missing on-chain Blob object ids from a prior partially-persisted
  // attempt before deciding resume vs mismatch vs fresh. If re-query fails we
  // propagate without clearing the record so a future retry can try again.
  if (matchingRecovery && !matchingRecovery.blobs.every((b) => !!b.blobObjectId)) {
    const resolvedIds = await resolveCreatedBlobObjectIds({
      suiClient: params.suiClient,
      walrusClient: client,
      digest: matchingRecovery.registerTxDigest,
      expectedBlobIds: matchingRecovery.blobs.map((b) => b.blobId),
    })
    matchingRecovery.blobs.forEach((b, i) => { b.blobObjectId = resolvedIds[i] })
    persistWalrusBatchRecovery(recoveryKey, {
      walletAddress: params.walletAddress,
      network,
      storageEpochs,
      registerTxDigest: matchingRecovery.registerTxDigest,
      blobs: matchingRecovery.blobs,
    })
  }

  let mode: 'fresh' | 'resume'
  let resumedRegisterTxDigest: string | null = null
  let resumedBlobObjectIds: string[] | null = null

  if (matchingRecovery && blobIdsMatch) {
    mode = 'resume'
    resumedRegisterTxDigest = matchingRecovery.registerTxDigest
    resumedBlobObjectIds = matchingRecovery.blobs.map((b) => b.blobObjectId as string)
  } else if (matchingRecovery && !blobIdsMatch) {
    const orphanBlobs = matchingRecovery.blobs.map((b) => ({
      blobId: b.blobId,
      blobObjectId: b.blobObjectId,
    }))
    clearWalrusBatchRecovery(recoveryKey)
    throw new WalrusUploadResumeMismatchError({
      message:
        'Cannot resume the previous Walrus batch upload because at least one payload changed. '
        + `A previous register transaction (${matchingRecovery.registerTxDigest}) created `
        + `${matchingRecovery.blobs.length} Blob object(s) that are now orphaned and will not be reused. `
        + 'Restart the deploy from a clean state, or use the Walrus deletable-blob flow to reclaim the orphans.',
      orphanBlobs,
      orphanTxDigest: matchingRecovery.registerTxDigest,
    })
  } else {
    mode = 'fresh'
  }

  if (mode === 'fresh') {
    if (!quoteApprovedBeforeUpload) {
      const approved = await params.confirmQuote(quote)
      if (!approved) {
        throw new WalrusUploadCancelledError('Walrus upload was cancelled before wallet signing')
      }
      if (!isWalrusUploadQuoteFresh(quote, plan)) {
        throw new Error('Walrus upload quote expired before wallet signing')
      }
    }
  }

  const continuation: BatchWalrusContinuation = {
    network,
    walletAddress: params.walletAddress,
    storageEpochs,
    suiClient: params.suiClient,
    walrusClient: client,
    transport,
    prepared,
    encodedList,
    managedUploader,
    recoveryKey,
    resumedBlobObjectIds,
    quote,
  }

  const appendRegisterCalls = (tx: Transaction) => {
    if (mode === 'resume') return
    tx.setSenderIfNotSet(params.walletAddress)
    const blobArgs = []
    for (let i = 0; i < prepared.length; i++) {
      const m = encodedList[i]
      const size = prepared[i].payload.byteLength
      const blob = tx.add(
        client.registerBlob({
          size,
          epochs: storageEpochs,
          blobId: m.blobId,
          rootHash: m.rootHash,
          deletable: true,
        }),
      )
      blobArgs.push(blob)
    }
    for (let i = 0; i < prepared.length; i++) {
      const recipient = prepared[i].item.sendObjectTo?.trim() || params.walletAddress
      tx.transferObjects([blobArgs[i]], recipient)
    }
  }

  return {
    mode,
    fileCount: prepared.length,
    blobUrls: encodedList.map((m) => getBlobUrl(m.blobId, network)),
    contentHashes: prepared.map((p) => p.contentHash),
    skillBundleMetadata: prepared.map((p) => p.skillBundleMetadata),
    quote,
    resumedRegisterTxDigest,
    appendRegisterCalls,
    __continuation: continuation,
  }
}

export async function completeBatchWalrusUploadAfterRegister(
  params: CompleteBatchWalrusUploadAfterRegisterParams,
): Promise<CompleteBatchWalrusUploadResult> {
  const intent = params.intent
  const ctx = intent.__continuation
  const { walrusClient: client, prepared, encodedList, recoveryKey, network } = ctx

  let registerDigest: string
  let blobObjectIds: string[]

  if (intent.mode === 'resume') {
    if (!intent.resumedRegisterTxDigest || !ctx.resumedBlobObjectIds) {
      throw new Error('Resume intent missing recovered register digest or Blob object ids')
    }
    registerDigest = intent.resumedRegisterTxDigest
    blobObjectIds = ctx.resumedBlobObjectIds
  } else {
    if (!params.registerTxDigest) {
      throw new Error('completeBatchWalrusUploadAfterRegister requires registerTxDigest for a fresh intent')
    }
    registerDigest = params.registerTxDigest

    // Persist register state IMMEDIATELY (resolve hasn't run yet) so a failure
    // between here and certify does not silently re-register on the next try.
    // The persisted `sealMaterial` lets the resume path re-encrypt
    // deterministically and reproduce the same blobIds — without it, the next
    // attempt would generate a fresh AES-GCM key/IV, hit
    // `WalrusUploadResumeMismatchError`, and strand the already-paid Blob
    // objects.
    const initialBlobs: WalrusBatchRecoveryBlob[] = prepared.map((p, i) => ({
      contentHash: p.contentHash,
      sendObjectTo: p.item.sendObjectTo?.trim() || ctx.walletAddress,
      payloadByteLength: p.payload.byteLength,
      blobId: encodedList[i].blobId,
      uploadId: encodedList[i].uploadId ?? null,
      blobObjectId: null,
      sealMaterial: p.encrypted?.material ?? null,
    }))
    persistWalrusBatchRecovery(recoveryKey, {
      walletAddress: ctx.walletAddress,
      network,
      storageEpochs: ctx.storageEpochs,
      registerTxDigest: registerDigest,
      blobs: initialBlobs,
    })

    blobObjectIds = await resolveCreatedBlobObjectIds({
      suiClient: ctx.suiClient,
      walrusClient: client,
      digest: registerDigest,
      expectedBlobIds: encodedList.map((m) => m.blobId),
    })

    persistWalrusBatchRecovery(recoveryKey, {
      walletAddress: ctx.walletAddress,
      network,
      storageEpochs: ctx.storageEpochs,
      registerTxDigest: registerDigest,
      blobs: initialBlobs.map((b, i) => ({ ...b, blobObjectId: blobObjectIds[i] })),
    })
  }

  const transport = params.transport ?? ctx.transport ?? getConfiguredWalrusUploadTransport()
  const uploaded = transport === 'managed'
    ? await completeEncodedBlobsViaManagedUploader({
        credentials: ctx.managedUploader ?? (() => {
          throw new Error('Walrus managed uploader credentials are missing from upload intent')
        })(),
        network,
        walletAddress: ctx.walletAddress,
        registerTxDigest: registerDigest,
        encodedList,
        blobObjectIds,
      })
    : transport === 'server'
      ? await completeEncodedBlobsViaServer({
        network,
        walletAddress: ctx.walletAddress,
        registerTxDigest: registerDigest,
        encodedList: encodedList.map((encoded, index) => {
          const local = requireBrowserEncodedBlob(encoded, index)
          return {
            blobId: encoded.blobId,
            rootHash: encoded.rootHash,
            metadata: local.metadata,
            sliversByNode: local.sliversByNode,
          }
        }),
        blobObjectIds,
        authHeaders: params.authHeaders,
      })
    : await (async () => {
        const browserUploaded: Awaited<ReturnType<typeof writeEncodedBlobAndBuildCertificate>>[] = []
        for (let i = 0; i < prepared.length; i++) {
          const m = encodedList[i]
          const local = requireBrowserEncodedBlob(m, i)
          browserUploaded.push(await writeEncodedBlobAndBuildCertificate({
            client,
            blobId: m.blobId,
            blobObjectId: blobObjectIds[i],
            metadata: local.metadata,
            sliversByNode: local.sliversByNode,
            deletable: true,
          }))
        }
        return browserUploaded
      })()

  const files: SoulUploadResult[] = prepared.map((p, i) => {
    p.plaintext.fill(0)
    if (p.encrypted) p.payload.fill(0)
    return {
      blobId: uploaded[i].blobId,
      blobObjectId: uploaded[i].blobObjectId,
      contentHash: p.contentHash,
      blobUrl: getBlobUrl(uploaded[i].blobId, network),
      sealMaterial: p.encrypted?.material ?? null,
      skillName: p.skillBundleMetadata?.skillName ?? null,
      storageTxDigest: registerDigest,
      certifyTxDigest: '',
      quoteId: ctx.quote.id,
    }
  })

  const attachCertifyCalls = async (mintTx: Transaction, indices?: ReadonlyArray<number>) => {
    const targetIndices = indices ?? uploaded.map((_, i) => i)
    for (const i of targetIndices) {
      if (i < 0 || i >= uploaded.length) {
        throw new Error(`attachCertifyCalls index ${i} is out of range (have ${uploaded.length} files)`)
      }
      mintTx.add(
        client.certifyBlob({
          blobId: uploaded[i].blobId,
          blobObjectId: uploaded[i].blobObjectId,
          certificate: uploaded[i].certificate,
          deletable: true,
        }),
      )
    }
  }

  return {
    files,
    registerTxDigest: registerDigest,
    attachCertifyCalls,
    clearBatchRecovery: () => {
      if (transport === 'managed' && ctx.managedUploader) {
        for (const encoded of encodedList) {
          if (!encoded.uploadId) continue
          void finalizeManagedWalrusUpload({
            credentials: ctx.managedUploader,
            uploadId: encoded.uploadId,
            walletAddress: ctx.walletAddress,
            network,
          })
        }
      }
      clearWalrusBatchRecovery(recoveryKey)
    },
  }
}

export async function prepareSoulBlobsForBatchPublish(
  params: PrepareSoulBlobsForBatchPublishParams,
): Promise<PreparedSoulBlobs> {
  const intent = await prepareBatchWalrusRegisterIntent({
    files: params.files,
    walletAddress: params.walletAddress,
    suiClient: params.suiClient,
    confirmQuote: params.confirmQuote,
    authHeaders: params.authHeaders,
    transport: params.transport,
    storageEpochs: params.storageEpochs,
  })

  let registerTxDigest: string | null = null
  if (intent.mode === 'fresh') {
    const tx = new Transaction()
    intent.appendRegisterCalls(tx)
    const registerResult = await params.signAndExecute(tx)
    try {
      assertSuiTxSucceeded(registerResult, 'Walrus batch register transaction')
    } catch (error) {
      intent.__continuation.recoveryKey
        && clearWalrusBatchRecovery(intent.__continuation.recoveryKey)
      throw error
    }
    registerTxDigest = registerResult.digest
  }

  return completeBatchWalrusUploadAfterRegister({
    intent,
    registerTxDigest,
    authHeaders: params.authHeaders,
    transport: params.transport,
  })
}

// ---------------------------------------------------------------------------
// Legacy single-blob path (still used for cover image until the publish flow
// is fully migrated). To be removed in the cleanup step once gas/page.tsx and
// use-publish.ts are switched over to the batch path above.
// ---------------------------------------------------------------------------

export async function uploadSoulPayload(params: UploadSoulPayloadParams): Promise<SoulUploadResult> {
  const { file, uploadType } = params
  const contentType = inferSoulUploadContentType(file, uploadType)
  const normalizedFile = file.type === contentType ? file : new File([file], file.name, { type: contentType })
  const fileError = validateSoulUploadFile(normalizedFile, uploadType)
  if (fileError) throw new Error(fileError)

  const plaintext = new Uint8Array(await normalizedFile.arrayBuffer())
  const signatureError = validateSoulUploadSignature(plaintext, uploadType, contentType)
  if (signatureError) throw new Error(signatureError)

  const skillBundleMetadata = params.extractSkillMetadata && hasZipSignature(plaintext)
    ? extractSkillBundleMetadata(plaintext)
    : null
  const contentHash = await sha256Hex(plaintext)
  const encrypted = uploadType === 'encrypted'
    ? await encryptClientSide({
        plaintext,
        mimeType: contentType,
        fileName: normalizedFile.name || 'bundle',
      })
    : null
  const payload = encrypted ? encrypted.ciphertext : plaintext

  const network = getWalrusNetwork()
  const relayUrl = getUploadRelayUrl(network)
  const storageEpochs = params.storageEpochs ?? DEFAULT_STORAGE_EPOCHS
  const plan = buildWalrusUploadPlan({
    files: [{
      name: normalizedFile.name || params.kind,
      size: plaintext.byteLength,
      encryptedSize: payload.byteLength,
    }],
    network,
    storageEpochs,
    chunking: false,
    relayUrl,
  })

  const quoteClient = await createWalrusClient({
    suiClient: params.suiClient,
    network,
    relayUrl,
    maxRelayTipMist: QUOTE_RELAY_TIP_MAX_MIST,
  })
  const quote = await quoteWalrusUpload(plan, {
    fetchStorageCost: (payloadBytes, epochs) => quoteClient.storageCost(payloadBytes, epochs),
    // Delegate to the SDK so the quoted tip uses the encoded blob size with the
    // live n_shards, matching what `WriteBlobFlow` will actually transfer at
    // sign time. The quoteClient is constructed with maxRelayTipMist =
    // MAX_SAFE_INTEGER, so the SDK's max-check cannot throw during quoting.
    calculateRelayTip: async (payloadBytes) =>
      BigInt(await quoteClient.calculateUploadRelayTip({ size: payloadBytes })),
  })
  const approved = await params.confirmQuote(quote)
  if (!approved) {
    throw new WalrusUploadCancelledError('Walrus upload was cancelled before wallet signing')
  }
  if (!isWalrusUploadQuoteFresh(quote, plan)) {
    throw new Error('Walrus upload quote expired before wallet signing')
  }

  const uploaded = await uploadPayloadToWalrus({
    name: normalizedFile.name || params.kind,
    contentHash,
    payload: cloneBytes(payload),
    walletAddress: params.sendObjectTo?.trim() || params.walletAddress,
    suiClient: params.suiClient,
    signAndExecute: params.signAndExecute,
    storageEpochs,
    plan,
    quote,
    network,
    relayUrl,
    // Recovery key is keyed on the plaintext hash so encrypted retries (which
    // re-encrypt with a fresh DEK and produce a different ciphertext blobId)
    // still surface the prior orphaned register via the same key.
    payloadHash: contentHash,
  })

  plaintext.fill(0)
  if (encrypted) payload.fill(0)

  return {
    blobId: uploaded.blobId,
    blobObjectId: uploaded.blobObjectId,
    contentHash,
    blobUrl: getBlobUrl(uploaded.blobId, network),
    sealMaterial: encrypted?.material ?? null,
    skillName: skillBundleMetadata?.skillName ?? null,
    storageTxDigest: uploaded.storageTxDigest,
    certifyTxDigest: uploaded.certifyTxDigest,
    quoteId: quote.id,
  }
}
