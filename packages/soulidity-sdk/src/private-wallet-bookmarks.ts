import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase58, fromBase64, fromHex, toBase58, toBase64 } from '@mysten/sui/utils'

/** Release-selected code identity. Raw readers independently verify this digest. */
export interface PrivateWalletBookmarksDeployment {
  originalPackageId: string
  callablePackageId: string
  callableDigest: string
  chainIdentifier: string
}
/** No public Profile, Soul, asset ownership or native dependency is required. */
export interface PrivateWalletBookmarksScope { registryId: string; owner: string }
export interface PrivateWalletBookmarksCipherRef {
  blobObjectId: string
  blobId: string
  sha256: string
  byteLength: string
}
export interface PrivateWalletBookmarksReceipt {
  requestId: string
  revision: string
  ciphertext: Readonly<PrivateWalletBookmarksCipherRef>
}
export interface PrivateWalletBookmarksHead {
  scope: Readonly<PrivateWalletBookmarksScope>
  revision: string
  ciphertext: Readonly<PrivateWalletBookmarksCipherRef>
  receipts: readonly Readonly<PrivateWalletBookmarksReceipt>[]
}
export const PRIVATE_WALLET_BOOKMARKS_MAX_U64 = 18446744073709551615n
export const PRIVATE_WALLET_BOOKMARKS_MAX_CIPHERTEXT_BYTES = 16_777_216
export const PRIVATE_WALLET_BOOKMARKS_MAX_RECEIPTS = 32
export const PRIVATE_WALLET_BOOKMARKS_SEAL_DOMAIN = 'soulidity/private-bookmarks/seal-id/v1'

const A = bcs.Address, U = bcs.u64(), V = bcs.vector(bcs.u8())
export const PrivateWalletBookmarksHeadKeyV1Bcs = bcs.struct('BookmarksHeadKeyV1', {
  version: bcs.u8(), owner: A,
})
export const PrivateWalletBookmarksCipherRefV1Bcs = bcs.struct('BookmarksCipherRefV1', {
  blob_object_id: A, blob_id: bcs.string(), sha256: V, byte_length: U,
})
export const PrivateWalletBookmarksReceiptV1Bcs = bcs.struct('BookmarksReceiptV1', {
  request_id: V, revision: U, ciphertext: PrivateWalletBookmarksCipherRefV1Bcs,
})
export const PrivateWalletBookmarksHeadV1Bcs = bcs.struct('BookmarksHeadV1', {
  version: bcs.u8(), registry_id: A, owner: A, revision: U,
  ciphertext: PrivateWalletBookmarksCipherRefV1Bcs, receipts: bcs.vector(PrivateWalletBookmarksReceiptV1Bcs),
})
export const PrivateWalletBookmarksHeadFieldV1Bcs = bcs.struct('BookmarksHeadFieldV1', {
  id: A, name: PrivateWalletBookmarksHeadKeyV1Bcs, value: PrivateWalletBookmarksHeadV1Bcs,
})
export const PrivateWalletBookmarksSealScopeV1Bcs = bcs.struct('BookmarksSealScopeV1', {
  domain: bcs.string(), version: bcs.u8(), registry_id: A, owner: A,
})

export function privateWalletBookmarksCheck(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`PRIVATE_WALLET_BOOKMARKS_${code}`)
}
const check: typeof privateWalletBookmarksCheck = privateWalletBookmarksCheck
export function assertPrivateWalletBookmarksId(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'INVALID_ID')
}
export function assertPrivateWalletBookmarksU64(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
    && BigInt(value) <= PRIVATE_WALLET_BOOKMARKS_MAX_U64, 'INVALID_U64')
}
export function assertPrivateWalletBookmarksHash(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) && !/^0+$/.test(value), 'INVALID_HASH')
}
function exact(value: unknown, fields: readonly string[]) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)), 'INVALID_FIELDS')
}
export function assertPrivateWalletBookmarksDeployment(input: PrivateWalletBookmarksDeployment): Readonly<PrivateWalletBookmarksDeployment> {
  const value = structuredClone(input)
  exact(value, ['originalPackageId', 'callablePackageId', 'callableDigest', 'chainIdentifier'])
  assertPrivateWalletBookmarksId(value.originalPackageId); assertPrivateWalletBookmarksId(value.callablePackageId)
  check(typeof value.callableDigest === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.callableDigest)
    && fromBase58(value.callableDigest).length === 32 && toBase58(fromBase58(value.callableDigest)) === value.callableDigest,
  'INVALID_PACKAGE_DIGEST')
  check(typeof value.chainIdentifier === 'string' && /^[0-9a-f]{8}$/.test(value.chainIdentifier), 'INVALID_CHAIN')
  return Object.freeze(value)
}
export function assertPrivateWalletBookmarksScope(input: PrivateWalletBookmarksScope): Readonly<PrivateWalletBookmarksScope> {
  const value = structuredClone(input)
  exact(value, ['registryId', 'owner'])
  assertPrivateWalletBookmarksId(value.registryId); assertPrivateWalletBookmarksId(value.owner)
  check(value.registryId !== value.owner, 'SCOPE_ALIAS')
  return Object.freeze(value)
}
export function assertPrivateWalletBookmarksCipherRef(input: PrivateWalletBookmarksCipherRef): Readonly<PrivateWalletBookmarksCipherRef> {
  const value = structuredClone(input)
  exact(value, ['blobObjectId', 'blobId', 'sha256', 'byteLength'])
  assertPrivateWalletBookmarksId(value.blobObjectId); assertPrivateWalletBookmarksHash(value.sha256)
  assertPrivateWalletBookmarksU64(value.byteLength)
  check(BigInt(value.byteLength) > 0n && BigInt(value.byteLength) <= BigInt(PRIVATE_WALLET_BOOKMARKS_MAX_CIPHERTEXT_BYTES), 'CIPHERTEXT_BUDGET')
  check(typeof value.blobId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.blobId), 'INVALID_BLOB_ID')
  const bytes = fromBase64(value.blobId.replaceAll('-', '+').replaceAll('_', '/') + '=')
  check(bytes.length === 32 && toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === value.blobId, 'INVALID_BLOB_ID')
  return Object.freeze(value)
}
export function derivePrivateWalletBookmarksHeadFieldId(originalPackageId: string, input: PrivateWalletBookmarksScope): string {
  assertPrivateWalletBookmarksId(originalPackageId)
  const scope = assertPrivateWalletBookmarksScope(input)
  return deriveDynamicFieldID(scope.registryId, `${originalPackageId}::profile::BookmarksHeadKeyV1`,
    PrivateWalletBookmarksHeadKeyV1Bcs.serialize({ version: 1, owner: scope.owner }).toBytes())
}
/** Exact Move BCS preimage. No head revision, Blob ID, secret or private intent. */
export async function derivePrivateWalletBookmarksSealId(input: PrivateWalletBookmarksScope): Promise<Uint8Array> {
  const scope = assertPrivateWalletBookmarksScope(input)
  const bytes = PrivateWalletBookmarksSealScopeV1Bcs.serialize({ domain: PRIVATE_WALLET_BOOKMARKS_SEAL_DOMAIN,
    version: 1, registry_id: scope.registryId, owner: scope.owner }).toBytes()
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
}
export interface PrivateWalletBookmarksMutationParams {
  deployment: PrivateWalletBookmarksDeployment
  scope: PrivateWalletBookmarksScope
  expectedRevision: string
  requestId: string
  ciphertext: PrivateWalletBookmarksCipherRef
}
/** Separate reference CAS after paid certification. Never uploads or signs. */
export function buildCommitPrivateWalletBookmarksTx(input: PrivateWalletBookmarksMutationParams): Transaction {
  const p = structuredClone(input)
  const deployment = assertPrivateWalletBookmarksDeployment(p.deployment), scope = assertPrivateWalletBookmarksScope(p.scope)
  assertPrivateWalletBookmarksU64(p.expectedRevision); assertPrivateWalletBookmarksHash(p.requestId)
  check(BigInt(p.expectedRevision) < PRIVATE_WALLET_BOOKMARKS_MAX_U64, 'REVISION_EXHAUSTED')
  const ciphertext = assertPrivateWalletBookmarksCipherRef(p.ciphertext)
  const tx = new Transaction(); tx.setSender(scope.owner)
  tx.moveCall({ target: `${deployment.callablePackageId}::profile::commit_bookmarks`, arguments: [
    tx.object(scope.registryId), tx.pure.u64(p.expectedRevision), tx.pure.vector('u8', [...fromHex(p.requestId)]),
    tx.pure.id(ciphertext.blobObjectId), tx.pure.string(ciphertext.blobId),
    tx.pure.vector('u8', [...fromHex(ciphertext.sha256)]), tx.pure.u64(ciphertext.byteLength),
  ] })
  return tx
}
/** Read-only Seal TransactionKind, not a transaction to sign or submit. */
export async function buildPrivateWalletBookmarksSealApproval(input: {
  deployment: PrivateWalletBookmarksDeployment; scope: PrivateWalletBookmarksScope
}): Promise<Transaction> {
  const deployment = assertPrivateWalletBookmarksDeployment(input.deployment), scope = assertPrivateWalletBookmarksScope(input.scope)
  const sealId = await derivePrivateWalletBookmarksSealId(scope)
  const tx = new Transaction(); tx.setSender(scope.owner)
  tx.moveCall({ target: `${deployment.callablePackageId}::profile::seal_approve_bookmarks`, arguments: [
    tx.pure.vector('u8', [...sealId]), tx.object(scope.registryId),
  ] })
  return tx
}
