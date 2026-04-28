'use client'

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

export class WalrusUploadResumeMismatchError extends Error {
  readonly orphanBlobObjectId: string | null
  readonly orphanTxDigest: string
  readonly orphanBlobId: string

  constructor(params: {
    message: string
    orphanBlobObjectId: string | null
    orphanTxDigest: string
    orphanBlobId: string
  }) {
    super(params.message)
    this.name = 'WalrusUploadResumeMismatchError'
    this.orphanBlobObjectId = params.orphanBlobObjectId
    this.orphanTxDigest = params.orphanTxDigest
    this.orphanBlobId = params.orphanBlobId
  }
}
