'use client'

import type { PendingSealMaterial } from '@/lib/upload/client-seal'

/**
 * sessionStorage-backed recovery for wallet-paid Walrus uploads.
 *
 * After the user signs the register transaction, the wallet has paid for an
 * on-chain Blob object even if the relay upload or certify step later fails.
 * Persisting that state lets the next attempt resume via the SDK's
 * `writeBlobFlow({ resume })` instead of paying again, and it gives downstream
 * UX the orphan Blob object id when resume is impossible (e.g. a fresh
 * encryption produced a different blobId).
 */

const KEY_PREFIX = 'soulidity.walrus-upload-recovery:'
const TTL_MS = 24 * 60 * 60 * 1000 // 24h is generous; a deletable register costs only the WAL deposit + tip.

export interface WalrusUploadRecoveryRecord {
  walletAddress: string
  network: 'testnet' | 'mainnet'
  contentHash: string
  payloadByteLength: number
  storageEpochs: number
  blobId: string
  blobObjectId: string | null
  txDigest: string
  nonce: string | null
  deletable: boolean
  savedAt: number
}

export interface WalrusUploadRecoveryKeyParts {
  network: 'testnet' | 'mainnet'
  walletAddress: string
  contentHash: string
  payloadByteLength: number
  storageEpochs: number
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

export function buildWalrusUploadRecoveryKey(parts: WalrusUploadRecoveryKeyParts): string {
  return [
    KEY_PREFIX,
    parts.network,
    parts.walletAddress.toLowerCase(),
    parts.contentHash,
    String(parts.payloadByteLength),
    String(parts.storageEpochs),
  ].join('|')
}

function isRecord(value: unknown): value is WalrusUploadRecoveryRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WalrusUploadRecoveryRecord>
  return (
    typeof candidate.walletAddress === 'string'
    && (candidate.network === 'testnet' || candidate.network === 'mainnet')
    && typeof candidate.contentHash === 'string'
    && typeof candidate.payloadByteLength === 'number'
    && typeof candidate.storageEpochs === 'number'
    && typeof candidate.blobId === 'string'
    && (candidate.blobObjectId === null || typeof candidate.blobObjectId === 'string')
    && typeof candidate.txDigest === 'string'
    && (candidate.nonce === null || typeof candidate.nonce === 'string')
    && typeof candidate.deletable === 'boolean'
    && typeof candidate.savedAt === 'number'
  )
}

export function readWalrusUploadRecovery(key: string): WalrusUploadRecoveryRecord | null {
  const s = storage()
  if (!s) return null
  let raw: string | null = null
  try {
    raw = s.getItem(key)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      try { s.removeItem(key) } catch {}
      return null
    }
    if (Date.now() - parsed.savedAt > TTL_MS) {
      try { s.removeItem(key) } catch {}
      return null
    }
    return parsed
  } catch {
    try { s.removeItem(key) } catch {}
    return null
  }
}

export function persistWalrusUploadRecovery(key: string, record: Omit<WalrusUploadRecoveryRecord, 'savedAt'>): void {
  const s = storage()
  if (!s) return
  try {
    const payload: WalrusUploadRecoveryRecord = { ...record, savedAt: Date.now() }
    s.setItem(key, JSON.stringify(payload))
  } catch {
    /* swallow */
  }
}

export function clearWalrusUploadRecovery(key: string): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(key)
  } catch {
    /* swallow */
  }
}

export interface WalrusOrphanBlob {
  /** SDK blobId from the prior register. */
  blobId: string
  /** Resolved on-chain Blob object id, or null if it could not be derived. */
  blobObjectId: string | null
}

export class WalrusUploadResumeMismatchError extends Error {
  /**
   * Every orphaned Blob from the previous register that will not be reused.
   * Single-blob path always carries one entry; the batch path carries one
   * entry per file in the batch so the deletable-blob cleanup flow has every
   * object id, not just the first.
   */
  readonly orphanBlobs: ReadonlyArray<WalrusOrphanBlob>
  readonly orphanTxDigest: string

  constructor(params: {
    message: string
    orphanBlobs: ReadonlyArray<WalrusOrphanBlob>
    orphanTxDigest: string
  }) {
    super(params.message)
    this.name = 'WalrusUploadResumeMismatchError'
    this.orphanBlobs = params.orphanBlobs
    this.orphanTxDigest = params.orphanTxDigest
  }
}

// ---------------------------------------------------------------------------
// Batch recovery — for `prepareSoulBlobsForBatchPublish`. Same semantics as
// the single-blob recovery above: the wallet has paid PTB1 (registerBlob × N)
// even if the storage-node uploads, certificates, or mint PTB later fail.
// Persisting that state lets the next attempt reuse the registered Blob
// objects instead of paying again, and surfaces the orphan IDs when the new
// attempt's encoded blobs don't match (e.g. encryption regenerated keys).
// ---------------------------------------------------------------------------

const BATCH_KEY_PREFIX = 'soulidity.walrus-batch-upload-recovery:'

export interface WalrusBatchRecoveryBlob {
  /** Plaintext SHA-256 of the source file — stable across re-encryption. */
  contentHash: string
  /** Resolved recipient address for `transferObjects`. */
  sendObjectTo: string
  /** Encoded payload byte length used for the prior register. */
  payloadByteLength: number
  /** SDK blobId from the prior `client.encodeBlob(payload)`. */
  blobId: string
  /** On-chain Blob object id resolved from the register tx; null until
   *  `resolveCreatedBlobObjectIds` succeeds. */
  blobObjectId: string | null
  /**
   * AES-GCM key/IV used for the prior encryption of this file. Persisted only
   * when the file's uploadType was `'encrypted'` so the resume path can re-run
   * `encryptClientSide` deterministically and reproduce the same blobId. Null
   * for public (plaintext) blobs whose blobId is already deterministic.
   *
   * Without this field, a fresh re-encryption on resume generates a new
   * AES-GCM key + IV — and therefore a different ciphertext and a different
   * Walrus blobId — which strands the already-paid Blob objects via
   * `WalrusUploadResumeMismatchError`.
   */
  sealMaterial?: PendingSealMaterial | null
}

export interface WalrusBatchRecoveryRecord {
  walletAddress: string
  network: 'testnet' | 'mainnet'
  storageEpochs: number
  registerTxDigest: string
  blobs: WalrusBatchRecoveryBlob[]
  savedAt: number
}

export interface WalrusBatchRecoveryKeyParts {
  network: 'testnet' | 'mainnet'
  walletAddress: string
  storageEpochs: number
  /** Per-file `(contentHash, sendObjectTo)` in the same order as the input batch. */
  files: Array<{ contentHash: string; sendObjectTo: string }>
}

async function digestKeySuffix(parts: WalrusBatchRecoveryKeyParts): Promise<string> {
  const text = parts.files
    .map((f) => `${f.contentHash}|${f.sendObjectTo.toLowerCase()}`)
    .join('\n')
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    // Fallback: hex-join lengths + first chars (only used in non-browser contexts).
    return parts.files.map((f) => f.contentHash.slice(0, 8)).join('-')
  }
  const buf = new TextEncoder().encode(text)
  const hash = await globalThis.crypto.subtle.digest('SHA-256', buf)
  const bytes = new Uint8Array(hash)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

export async function buildWalrusBatchRecoveryKey(parts: WalrusBatchRecoveryKeyParts): Promise<string> {
  const suffix = await digestKeySuffix(parts)
  return [
    BATCH_KEY_PREFIX,
    parts.network,
    parts.walletAddress.toLowerCase(),
    String(parts.storageEpochs),
    String(parts.files.length),
    suffix,
  ].join('|')
}

function isPendingSealMaterial(value: unknown): value is PendingSealMaterial {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<PendingSealMaterial>
  return (
    c.version === 1
    && typeof c.dek === 'string'
    && typeof c.iv === 'string'
    && typeof c.contentHash === 'string'
    && typeof c.mimeType === 'string'
    && typeof c.fileName === 'string'
  )
}

function isBatchBlob(value: unknown): value is WalrusBatchRecoveryBlob {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<WalrusBatchRecoveryBlob>
  const sealMaterialOk =
    c.sealMaterial === undefined
    || c.sealMaterial === null
    || isPendingSealMaterial(c.sealMaterial)
  return (
    typeof c.contentHash === 'string'
    && typeof c.sendObjectTo === 'string'
    && typeof c.payloadByteLength === 'number'
    && typeof c.blobId === 'string'
    && (c.blobObjectId === null || typeof c.blobObjectId === 'string')
    && sealMaterialOk
  )
}

function isBatchRecord(value: unknown): value is WalrusBatchRecoveryRecord {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<WalrusBatchRecoveryRecord>
  return (
    typeof c.walletAddress === 'string'
    && (c.network === 'testnet' || c.network === 'mainnet')
    && typeof c.storageEpochs === 'number'
    && typeof c.registerTxDigest === 'string'
    && Array.isArray(c.blobs)
    && c.blobs.every(isBatchBlob)
    && typeof c.savedAt === 'number'
  )
}

export function readWalrusBatchRecovery(key: string): WalrusBatchRecoveryRecord | null {
  const s = storage()
  if (!s) return null
  let raw: string | null = null
  try {
    raw = s.getItem(key)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isBatchRecord(parsed)) {
      try { s.removeItem(key) } catch {}
      return null
    }
    if (Date.now() - parsed.savedAt > TTL_MS) {
      try { s.removeItem(key) } catch {}
      return null
    }
    return parsed
  } catch {
    try { s.removeItem(key) } catch {}
    return null
  }
}

export function persistWalrusBatchRecovery(
  key: string,
  record: Omit<WalrusBatchRecoveryRecord, 'savedAt'>,
): void {
  const s = storage()
  if (!s) return
  try {
    const payload: WalrusBatchRecoveryRecord = { ...record, savedAt: Date.now() }
    s.setItem(key, JSON.stringify(payload))
  } catch {
    /* swallow */
  }
}

export function clearWalrusBatchRecovery(key: string): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(key)
  } catch {
    /* swallow */
  }
}
