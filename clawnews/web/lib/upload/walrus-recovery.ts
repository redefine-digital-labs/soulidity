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
  /** Managed uploader staging id. Present only for managed transport attempts. */
  uploadId?: string | null
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
    && (c.uploadId === undefined || c.uploadId === null || typeof c.uploadId === 'string')
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

// ---------------------------------------------------------------------------
// Post-certify pending-sync — for `/content/sync` replay after refresh.
//
// The certify+append PTB commits on chain BEFORE `/content/sync` POSTs. If the
// sync fails (Vercel function timeout, Sui RPC blip, browser closed mid-fetch)
// the in-memory `sealMaterial` (DEK + IV) is permanently lost — and with it,
// the ability to decrypt the on-chain Walrus blob.
//
// We persist `sealMaterial` + chain context here AS SOON AS the certify TX
// resolves on the wallet, BEFORE the `/content/sync` POST. The hook clears
// the record only after the full sync chain (incl. sprite config / set-active
// extras) succeeds. Next page load detects pending records for the current
// soul + wallet, rebuilds the sidecar, and replays the sync — no extra wallet
// signature, no orphaned Walrus ciphertext.
// ---------------------------------------------------------------------------

const PENDING_SYNC_KEY_PREFIX = 'soulidity.content-sync-pending:'

export interface ContentSyncPendingSpriteExtras {
  spriteConfigJson?: string | null
  setActive?: boolean
}

export interface ContentSyncPendingRecord {
  soulOnChainId: string
  contentOnChainId: string
  certifyTxDigest: string
  kind: number
  /** Resolved name (skill bundle name from frontmatter, "default" for memory, etc.). */
  name: string
  /** Version index emitted by the on-chain `ContentVersionAppended` event. */
  versionIndex: number
  blobId: string
  /** Plaintext SHA-256 — must equal `sealMaterial.contentHash`. */
  contentHash: string
  /** Null for plaintext slots (none today, but reserved). */
  sealMaterial: PendingSealMaterial | null
  /** Sprite-upload extras spliced into the same certify+append PTB. */
  sprite?: ContentSyncPendingSpriteExtras
  /** Owner-issued append authority. Granted-agent grants are revocable, so
   *  we record the grant id used so a stale grant can be detected on replay. */
  granteeGrantOnChainId?: string | null
  /** Lowercased so scan filters match regardless of address casing. */
  walletAddress: string
  network: 'testnet' | 'mainnet'
  savedAt: number
}

export function buildContentSyncPendingKey(certifyTxDigest: string): string {
  return PENDING_SYNC_KEY_PREFIX + certifyTxDigest
}

function isContentSyncPendingRecord(value: unknown): value is ContentSyncPendingRecord {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<ContentSyncPendingRecord>
  const sealOk = c.sealMaterial === null || isPendingSealMaterial(c.sealMaterial)
  const spriteOk =
    c.sprite === undefined
    || (c.sprite !== null
      && typeof c.sprite === 'object'
      && (c.sprite.spriteConfigJson === undefined
        || c.sprite.spriteConfigJson === null
        || typeof c.sprite.spriteConfigJson === 'string')
      && (c.sprite.setActive === undefined || typeof c.sprite.setActive === 'boolean'))
  return (
    typeof c.soulOnChainId === 'string'
    && typeof c.contentOnChainId === 'string'
    && typeof c.certifyTxDigest === 'string'
    && typeof c.kind === 'number'
    && typeof c.name === 'string'
    && typeof c.versionIndex === 'number'
    && typeof c.blobId === 'string'
    && typeof c.contentHash === 'string'
    && sealOk
    && spriteOk
    && (c.granteeGrantOnChainId === undefined
      || c.granteeGrantOnChainId === null
      || typeof c.granteeGrantOnChainId === 'string')
    && typeof c.walletAddress === 'string'
    && (c.network === 'testnet' || c.network === 'mainnet')
    && typeof c.savedAt === 'number'
  )
}

export function persistContentSyncPending(record: Omit<ContentSyncPendingRecord, 'savedAt'>): void {
  const s = storage()
  if (!s) return
  try {
    const payload: ContentSyncPendingRecord = {
      ...record,
      walletAddress: record.walletAddress.toLowerCase(),
      savedAt: Date.now(),
    }
    s.setItem(buildContentSyncPendingKey(record.certifyTxDigest), JSON.stringify(payload))
  } catch {
    /* swallow */
  }
}

export function clearContentSyncPending(certifyTxDigest: string): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(buildContentSyncPendingKey(certifyTxDigest))
  } catch {
    /* swallow */
  }
}

/**
 * Scan sessionStorage for pending-sync records bound to a specific
 * `(soulOnChainId, walletAddress, network)` triple. Drops expired entries
 * eagerly — the same 24h TTL as the wallet-paid recovery records, since the
 * sealMaterial is the most sensitive thing we persist client-side and a
 * page that hasn't loaded in a day is almost certainly never coming back.
 */
export function readContentSyncPendingForSoul(params: {
  soulOnChainId: string
  walletAddress: string
  network: 'testnet' | 'mainnet'
}): ContentSyncPendingRecord[] {
  const s = storage()
  if (!s) return []
  const wallet = params.walletAddress.toLowerCase()
  const out: ContentSyncPendingRecord[] = []
  // Snapshot the keys first because `removeItem` while iterating shifts indices.
  const keys: string[] = []
  for (let i = 0; i < s.length; i += 1) {
    const key = s.key(i)
    if (key && key.startsWith(PENDING_SYNC_KEY_PREFIX)) keys.push(key)
  }
  for (const key of keys) {
    try {
      const raw = s.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as unknown
      if (!isContentSyncPendingRecord(parsed)) {
        try { s.removeItem(key) } catch {}
        continue
      }
      if (Date.now() - parsed.savedAt > TTL_MS) {
        try { s.removeItem(key) } catch {}
        continue
      }
      if (parsed.network !== params.network) continue
      if (parsed.soulOnChainId !== params.soulOnChainId) continue
      if (parsed.walletAddress !== wallet) continue
      out.push(parsed)
    } catch {
      try { s.removeItem(key) } catch {}
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Paid-access revoke pending-sync — the revoke PTB commits on chain before the
// mirror POST. Persist the digest until `/paid-access` confirms the DB mirror.
// ---------------------------------------------------------------------------

const PAID_ACCESS_REVOKE_PENDING_KEY_PREFIX = 'soulidity.paid-access-revoke-pending:'

export interface PaidAccessRevokePendingRecord {
  soulOnChainId: string
  txDigest: string
  buyerAddress: string
  kind: number
  walletAddress: string
  network: 'testnet' | 'mainnet'
  savedAt: number
}

export function buildPaidAccessRevokePendingKey(txDigest: string): string {
  return PAID_ACCESS_REVOKE_PENDING_KEY_PREFIX + txDigest
}

function isPaidAccessRevokePendingRecord(value: unknown): value is PaidAccessRevokePendingRecord {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<PaidAccessRevokePendingRecord>
  return (
    typeof c.soulOnChainId === 'string'
    && typeof c.txDigest === 'string'
    && typeof c.buyerAddress === 'string'
    && typeof c.kind === 'number'
    && typeof c.walletAddress === 'string'
    && (c.network === 'testnet' || c.network === 'mainnet')
    && typeof c.savedAt === 'number'
  )
}

export function persistPaidAccessRevokePending(record: Omit<PaidAccessRevokePendingRecord, 'savedAt'>): void {
  const s = storage()
  if (!s) return
  try {
    const payload: PaidAccessRevokePendingRecord = {
      ...record,
      buyerAddress: record.buyerAddress.toLowerCase(),
      walletAddress: record.walletAddress.toLowerCase(),
      savedAt: Date.now(),
    }
    s.setItem(buildPaidAccessRevokePendingKey(record.txDigest), JSON.stringify(payload))
  } catch {
    /* swallow */
  }
}

export function clearPaidAccessRevokePending(txDigest: string): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(buildPaidAccessRevokePendingKey(txDigest))
  } catch {
    /* swallow */
  }
}

export function readPaidAccessRevokePendingForSoul(params: {
  soulOnChainId: string
  walletAddress: string
  network: 'testnet' | 'mainnet'
}): PaidAccessRevokePendingRecord[] {
  const s = storage()
  if (!s) return []
  const wallet = params.walletAddress.toLowerCase()
  const out: PaidAccessRevokePendingRecord[] = []
  const keys: string[] = []
  for (let i = 0; i < s.length; i += 1) {
    const key = s.key(i)
    if (key && key.startsWith(PAID_ACCESS_REVOKE_PENDING_KEY_PREFIX)) keys.push(key)
  }
  for (const key of keys) {
    try {
      const raw = s.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as unknown
      if (!isPaidAccessRevokePendingRecord(parsed)) {
        try { s.removeItem(key) } catch {}
        continue
      }
      if (Date.now() - parsed.savedAt > TTL_MS) {
        try { s.removeItem(key) } catch {}
        continue
      }
      if (parsed.network !== params.network) continue
      if (parsed.soulOnChainId !== params.soulOnChainId) continue
      if (parsed.walletAddress !== wallet) continue
      out.push(parsed)
    } catch {
      try { s.removeItem(key) } catch {}
    }
  }
  return out
}
