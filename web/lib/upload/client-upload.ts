'use client'

import type { Transaction } from '@mysten/sui/transactions'
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
  buildWalrusUploadRecoveryKey,
  clearWalrusUploadRecovery,
  persistWalrusUploadRecovery,
  readWalrusUploadRecovery,
  WalrusUploadResumeMismatchError,
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

export type SignAndExecuteWalrusTx = (tx: Transaction) => Promise<{ digest: string }>

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

const DEFAULT_STORAGE_EPOCHS = 3
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
  relayUrl: string
  maxRelayTipMist: bigint
}) {
  const { WalrusClient } = await import('@mysten/walrus')
  clearWalrusUploadRelayTipCache(params.suiClient)
  const maxTip = params.maxRelayTipMist > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(params.maxRelayTipMist)
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
        orphanBlobObjectId: resumeRecord.blobObjectId,
        orphanTxDigest: resumeRecord.txDigest,
        orphanBlobId: resumeRecord.blobId,
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
  })
  const approved = await params.confirmQuote(quote)
  if (!approved) {
    throw new Error('Walrus upload was cancelled before wallet signing')
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
