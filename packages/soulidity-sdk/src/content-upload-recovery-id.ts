import { fromHex, toHex } from '@mysten/sui/utils'

/** Dedicated author-only Seal namespace; never a Soul content document ID. */
export interface ContentUploadRecoveryScope {
  author: string
  contentObjectId: string
  operationHash: string
  /** Caller-generated, durably persisted 16-byte nonce as lowercase hex. */
  nonce: string
}
const domain = new TextEncoder().encode('soul-content-upload-recovery:')
export const CONTENT_UPLOAD_RECOVERY_ID_BYTES = 142

export function deriveContentUploadRecoveryId(scope: ContentUploadRecoveryScope): string {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)
    || Object.keys(scope).length !== 4 || !['author', 'contentObjectId', 'operationHash', 'nonce'].every(k => Object.hasOwn(scope, k))) {
    throw new Error('CONTENT_UPLOAD_RECOVERY_SCOPE_INVALID')
  }
  for (const value of [scope.author, scope.contentObjectId]) {
    if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) throw new Error('CONTENT_UPLOAD_RECOVERY_ID_INVALID')
  }
  if (typeof scope.operationHash !== 'string' || !/^[0-9a-f]{64}$/.test(scope.operationHash)
    || typeof scope.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(scope.nonce)) throw new Error('CONTENT_UPLOAD_RECOVERY_HASH_NONCE_INVALID')
  const bytes = new Uint8Array(CONTENT_UPLOAD_RECOVERY_ID_BYTES)
  bytes.set(domain); bytes[domain.length] = 1
  let offset = domain.length + 1
  for (const value of [scope.author, scope.contentObjectId, scope.operationHash, scope.nonce]) {
    const field = fromHex(value); bytes.set(field, offset); offset += field.length
  }
  return toHex(bytes)
}

/** Exact scope comparison, with no prefix/uppercase/length coercion. */
export function assertContentUploadRecoveryId(value: string, expected: ContentUploadRecoveryScope): void {
  if (typeof value !== 'string' || value !== deriveContentUploadRecoveryId(expected)) {
    throw new Error('CONTENT_UPLOAD_RECOVERY_SCOPE_MISMATCH')
  }
}
