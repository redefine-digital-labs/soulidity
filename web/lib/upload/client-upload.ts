'use client'

import { Transaction } from '@mysten/sui/transactions'
import { inferSoulUploadContentType } from '@/lib/upload/content-type'
import {
  buildWalrusUploadPlan,
  isWalrusUploadQuoteFresh,
  quoteWalrusUpload,
  type WalrusUploadPlan,
  type WalrusUploadQuote,
} from '@/lib/upload/walrus-quote'
import { encryptClientSide, sha256Hex, type PendingSealMaterial } from '@/lib/upload/client-seal'
import {
  extractSkillBundleMetadata,
  hasZipSignature,
  validateSoulUploadFile,
  validateSoulUploadSignature,
} from '@/lib/soulidity/upload-validation'
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
    // signAndExecute returns the raw executeTransactionBlock result and does
    // NOT reject on Move aborts: a digest can come back with
    // effects.status.status === 'failure' without throwing. Persisting
    // recovery off a failed register would point future resume attempts at a
    // digest that created no Blob, where `writeBlobFlow.encode({ resume })`
    // would throw with a stale-orphan error even though no Blob exists.
    const registerStatus = (registerResult as { effects?: { status?: { status?: string; error?: string } } } | null | undefined)?.effects?.status
    if (registerStatus?.status !== 'success') {
      clearWalrusUploadRecovery(params.recoveryKey)
      const detail = [registerStatus?.status ? `status=${registerStatus.status}` : null, registerStatus?.error ? `error=${registerStatus.error}` : null]
        .filter(Boolean)
        .join(', ')
      throw new Error(`Walrus register transaction ${registerResult.digest} did not succeed${detail ? ` (${detail})` : ''}`)
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
  // Mirror the register guard: signAndExecute returns the raw
  // executeTransactionBlock response and does NOT reject Move aborts, so a
  // certify digest can come back with effects.status.status === 'failure'
  // (stale/deleted Blob, gas failure). Clearing recovery off such a digest
  // would strand the caller — the registered Blob is still on chain but the
  // resume record needed to re-run certify without paying another register
  // is gone. Throw before flow.getBlob() and before clearing recovery so the
  // next attempt can resume at certify.
  const certifyStatus = (certifyResult as { effects?: { status?: { status?: string; error?: string } } } | null | undefined)?.effects?.status
  if (certifyStatus?.status !== 'success') {
    const detail = [certifyStatus?.status ? `status=${certifyStatus.status}` : null, certifyStatus?.error ? `error=${certifyStatus.error}` : null]
      .filter(Boolean)
      .join(', ')
    throw new Error(`Walrus certify transaction ${certifyResult.digest} did not succeed${detail ? ` (${detail})` : ''}`)
  }
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
}

export interface PreparedSoulBlobs {
  /** One result per input file, in the same order as `params.files`. */
  files: SoulUploadResult[]
  /** Digest of PTB1 (the register transaction). */
  registerTxDigest: string
  /** Splices N `certify_blob` calls into the caller's mint PTB. Must be called before signing PTB2. */
  attachCertifyCalls: (tx: Transaction) => Promise<void>
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

async function preparePayload(
  item: BatchSoulUploadFile,
  index: number,
): Promise<PreparedFile> {
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
  const skillBundleMetadata = hasZipSignature(plaintext)
    ? extractSkillBundleMetadata(plaintext)
    : null
  const contentHash = await sha256Hex(plaintext)
  const encrypted =
    item.uploadType === 'encrypted'
      ? await encryptClientSide({
          plaintext,
          mimeType: contentType,
          fileName: normalizedFile.name || 'bundle',
        })
      : null
  const payload = encrypted ? encrypted.ciphertext : plaintext
  return {
    index,
    item,
    contentType,
    normalizedFile,
    plaintext,
    payload,
    encrypted,
    contentHash,
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
  await client.waitForTransaction({ digest: params.digest })
  const tx = await client.getTransactionBlock({
    digest: params.digest,
    options: { showObjectChanges: true, showEffects: true },
  })
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
  const decoded = await Promise.all(
    createdBlobObjectIds.map((objectId) => params.walrusClient.getBlobObject(objectId)),
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
  let confirmations: Awaited<ReturnType<typeof params.client.writeEncodedBlobToNodes>>
  let writeError: unknown = null
  try {
    confirmations = await params.client.writeEncodedBlobToNodes({
      blobId: params.blobId,
      objectId: params.blobObjectId,
      metadata: params.metadata,
      sliversByNode: params.sliversByNode,
      deletable: params.deletable,
    })
  } catch (error) {
    writeError = error
    confirmations = await params.client.getStorageConfirmations({
      blobId: params.blobId,
      objectId: params.blobObjectId,
      deletable: params.deletable,
    })
  }

  try {
    const certificate = await params.client.certificateFromConfirmations({
      confirmations,
      blobId: params.blobId,
      blobObjectId: params.blobObjectId,
      deletable: params.deletable,
    })
    return {
      blobId: params.blobId,
      blobObjectId: params.blobObjectId,
      certificate,
    }
  } catch (certificateError) {
    if (writeError) throw writeError
    throw certificateError
  }
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
  const status = result.effects?.status
  if (status?.status !== 'success') {
    const detail = [status?.status ? `status=${status.status}` : null, status?.error ? `error=${status.error}` : null]
      .filter(Boolean)
      .join(', ')
    throw new Error(`Walrus orphan reclaim transaction ${result.digest} did not succeed${detail ? ` (${detail})` : ''}`)
  }

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

export async function prepareSoulBlobsForBatchPublish(
  params: PrepareSoulBlobsForBatchPublishParams,
): Promise<PreparedSoulBlobs> {
  if (params.files.length === 0) {
    throw new Error('At least one file is required for a batch Soul publish')
  }

  const network = getWalrusNetwork()
  const relayUrl = getUploadRelayUrl(network)
  const storageEpochs = params.storageEpochs ?? DEFAULT_STORAGE_EPOCHS

  // 1. Validate, encrypt, and hash all payloads in parallel.
  const prepared = await Promise.all(
    params.files.map((item, index) => preparePayload(item, index)),
  )

  // 2. Build a single aggregate quote and confirm with the user.
  //
  // The batch path bypasses the upload relay: the relay server only validates
  // the auth payload at `ptb.inputs.first()`, which makes a single PTB
  // unsuitable for registering N blobs (only one auth payload can occupy slot
  // 0). Direct storage-node uploads have no PTB-shape constraint, so we encode
  // each blob client-side and write the slivers directly. Relay tip is 0n.
  const plan = buildAggregateUploadPlan(prepared, network, storageEpochs, relayUrl)
  const quoteClient = await createWalrusClient({
    suiClient: params.suiClient,
    network,
  })
  const quote = await quoteWalrusUpload(plan, {
    fetchStorageCost: (payloadBytes, epochs) => quoteClient.storageCost(payloadBytes, epochs),
    calculateRelayTip: async () => 0n,
  })
  const approved = await params.confirmQuote(quote)
  if (!approved) {
    throw new WalrusUploadCancelledError('Walrus upload was cancelled before wallet signing')
  }
  if (!isWalrusUploadQuoteFresh(quote, plan)) {
    throw new Error('Walrus upload quote expired before wallet signing')
  }

  // 3. Same no-relay client; encode every blob into its full sliver set so the
  // direct upload step has the bytes ready (heavier than computeBlobMetadata
  // but unavoidable when bypassing the relay).
  const client = quoteClient
  const encodedList = await Promise.all(
    prepared.map((p) => client.encodeBlob(p.payload)),
  )

  // 3a. Batch recovery: PTB1 has been wallet-paid on a previous attempt if a
  // matching record exists. Resume direct upload + cert (no fresh register PTB)
  // when the new encoded blobIds line up; otherwise surface the orphan so the
  // user knows the prior register's Blob objects can be reclaimed/cleaned.
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
    // Different intent under the same key (corrupt or unrelated state) — drop.
    clearWalrusBatchRecovery(recoveryKey)
  }

  let registerDigest: string
  let blobObjectIds: string[]

  const blobIdsMatch =
    matchingRecovery
    && matchingRecovery.blobs.every(
      (b, i) =>
        b.blobId === encodedList[i].blobId
        && b.payloadByteLength === prepared[i].payload.byteLength,
    )

  // Recover missing on-chain Blob object ids from a partially-persisted prior
  // attempt. PTB1 succeeded and was persisted with all blobObjectId=null
  // (the "initial" persist below the fresh-register branch), but the
  // subsequent resolve + re-persist never ran because the browser, RPC, or
  // getTransactionBlock() failed in that gap. Without this re-derivation:
  //   - blobIdsMatch + missing object ids falls through to the fresh-register
  //     branch and silently orphans the prior paid PTB1.
  //   - !blobIdsMatch + missing object ids hits the mismatch branch with
  //     `orphanBlobObjectId: null` AND clears the only pointer to the orphan.
  // Re-query the stored register digest using the stored (prior) blob ids and
  // persist the resolved ids back into the recovery record before deciding
  // resume vs mismatch vs fresh. If the re-query itself fails we propagate
  // the error without clearing the record, so a future retry can try again.
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

  if (matchingRecovery && blobIdsMatch) {
    // 4a. Resume path — skip PTB1 entirely; the wallet-paid Blob objects from the
    // previous attempt are reused for the upload + cert + mint chain.
    registerDigest = matchingRecovery.registerTxDigest
    blobObjectIds = matchingRecovery.blobs.map((b) => b.blobObjectId as string)
  } else if (matchingRecovery && !blobIdsMatch) {
    // The new encoded payload doesn't line up with the previously registered
    // blobs (typical for encrypted batches because each prepare regenerates the
    // AES-GCM key). Surface an orphan error rather than silently signing a new
    // register PTB, which would burn another wallet payment for the same user
    // intent and orphan the prior Blob objects forever. Object ids are
    // guaranteed non-null here because the re-derivation block above either
    // populated them or threw before reaching this branch.
    //
    // Snapshot every orphan descriptor BEFORE clearing the recovery record so
    // the thrown error carries every blobObjectId — the deletable-blob flow
    // needs each one, not just the first.
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
    // 4b. Fresh path — PTB1: N register_blob calls + per-file transferObjects.
    // No auth payload, no relay tip — direct storage-node uploads carry their
    // own auth.
    const tx = new Transaction()
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

    // 5. Sign PTB1.
    const registerResult = await params.signAndExecute(tx)
    // signAndExecute returns the raw executeTransactionBlock result and does
    // NOT reject on Move aborts: the wallet helper resolves successfully even
    // when effects.status.status === 'failure'. Persisting batch recovery off
    // a failed digest wedges the next Deploy click — the resume branch tries
    // to re-derive Blob objects from a digest that created none, throws on
    // the missing objects, and the recovery record sticks. Verify the on-chain
    // status BEFORE assigning the digest or persisting any recovery, and clear
    // any stale record under the same key so a future retry can re-register
    // from a clean state.
    const registerStatus = (registerResult as { effects?: { status?: { status?: string; error?: string } } } | null | undefined)?.effects?.status
    if (registerStatus?.status !== 'success') {
      clearWalrusBatchRecovery(recoveryKey)
      const detail = [registerStatus?.status ? `status=${registerStatus.status}` : null, registerStatus?.error ? `error=${registerStatus.error}` : null]
        .filter(Boolean)
        .join(', ')
      throw new Error(`Walrus batch register transaction ${registerResult.digest} did not succeed${detail ? ` (${detail})` : ''}`)
    }
    registerDigest = registerResult.digest

    // 5a. Persist register state IMMEDIATELY after sign — before any upload /
    // resolve / certificate work — so a failure between here and the mint PTB
    // does not silently re-register the same batch on the next attempt.
    const initialBlobs: WalrusBatchRecoveryBlob[] = prepared.map((p, i) => ({
      contentHash: p.contentHash,
      sendObjectTo: p.item.sendObjectTo?.trim() || params.walletAddress,
      payloadByteLength: p.payload.byteLength,
      blobId: encodedList[i].blobId,
      blobObjectId: null,
    }))
    persistWalrusBatchRecovery(recoveryKey, {
      walletAddress: params.walletAddress,
      network,
      storageEpochs,
      registerTxDigest: registerDigest,
      blobs: initialBlobs,
    })

    // 6. Resolve every newly-created Blob object id, ordered by input.
    blobObjectIds = await resolveCreatedBlobObjectIds({
      suiClient: params.suiClient,
      walrusClient: client,
      digest: registerDigest,
      expectedBlobIds: encodedList.map((m) => m.blobId),
    })

    // 6a. Refresh recovery with the resolved on-chain Blob object ids so a
    // failure between here and certify+mint can resume direct uploads without
    // re-querying the digest.
    persistWalrusBatchRecovery(recoveryKey, {
      walletAddress: params.walletAddress,
      network,
      storageEpochs,
      registerTxDigest: registerDigest,
      blobs: initialBlobs.map((b, i) => ({ ...b, blobObjectId: blobObjectIds[i] })),
    })
  }

  // 7. Parallel direct uploads to storage nodes; build certificates from
  // returned confirmations.
  const uploaded = await Promise.all(
    prepared.map(async (_p, i) => {
      const m = encodedList[i]
      return writeEncodedBlobAndBuildCertificate({
        client,
        blobId: m.blobId,
        blobObjectId: blobObjectIds[i],
        metadata: m.metadata,
        sliversByNode: m.sliversByNode,
        deletable: true,
      })
    }),
  )

  // 8. Materialize per-file results and the certify-attach helper.
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
      // certifyTxDigest is filled in by the caller after PTB2 signs (it equals
      // the mint transaction digest because certify is co-bundled with mint).
      certifyTxDigest: '',
      quoteId: quote.id,
    }
  })

  const attachCertifyCalls = async (mintTx: Transaction) => {
    for (let i = 0; i < uploaded.length; i++) {
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
    clearBatchRecovery: () => clearWalrusBatchRecovery(recoveryKey),
  }
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

  const skillBundleMetadata = hasZipSignature(plaintext)
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
