import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { profileReadStep as step } from './profile-read-step'
import { ProfileRegistryV1Bcs } from './wallet-profile'
import { ProfileWalrusBlobBcs } from './public-profile-metadata'
import { assertPrivateWalletBookmarksCipherRef, assertPrivateWalletBookmarksDeployment,
  assertPrivateWalletBookmarksHash, assertPrivateWalletBookmarksId as id,
  assertPrivateWalletBookmarksScope, assertPrivateWalletBookmarksU64,
  derivePrivateWalletBookmarksHeadFieldId, privateWalletBookmarksCheck as check,
  PRIVATE_WALLET_BOOKMARKS_MAX_U64 as MAX_U64, PRIVATE_WALLET_BOOKMARKS_MAX_RECEIPTS,
  PrivateWalletBookmarksHeadFieldV1Bcs, type PrivateWalletBookmarksCipherRef,
  type PrivateWalletBookmarksDeployment, type PrivateWalletBookmarksHead,
  type PrivateWalletBookmarksReceipt, type PrivateWalletBookmarksScope } from './private-wallet-bookmarks'

export interface PrivateWalletBookmarksReadClient {
  core: Pick<SuiGrpcClient['core'], 'getChainIdentifier'>
  ledgerService: Pick<SuiGrpcClient['ledgerService'], 'getObject' | 'batchGetObjects'>
}
export interface PrivateWalletBookmarksReadParams {
  client: PrivateWalletBookmarksReadClient
  deployment: PrivateWalletBookmarksDeployment
  scope: PrivateWalletBookmarksScope
  signal?: AbortSignal
}
export interface PrivateWalletBookmarksHeadSnapshot {
  scope: Readonly<PrivateWalletBookmarksScope>
  revision: string
  head: Readonly<PrivateWalletBookmarksHead> | null
  emptyReason: 'ABSENT' | null
  registryVersion: string
  registryDigest: string
  headFieldId: string
  headFieldVersion: string | null
  headFieldDigest: string | null
}
export interface PrivateWalletBookmarksStorage { blobType: string; aggregatorUrl: string }
/** Bind to the same verified gRPC client/Walrus network. The adapter must reset
 * the Walrus SDK cache before systemState(); no cached/upload/Sui epoch fallback. */
export type FreshPrivateWalletBookmarksWalrusState = (signal: AbortSignal) => Promise<{ blobType: string; epoch: number }>
export interface PrivateWalletBookmarksCiphertextReadParams extends PrivateWalletBookmarksReadParams {
  storage: PrivateWalletBookmarksStorage
  freshWalrusState: FreshPrivateWalletBookmarksWalrusState
  fetcher?: typeof fetch
}

type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
type Raw = NonNullable<Awaited<ReturnType<PrivateWalletBookmarksReadClient['ledgerService']['getObject']>>['response']['object']>
const MASK = ['object_id', 'object_type', 'version', 'digest', 'owner', 'bcs', 'contents']
const HEAD_BUDGET = 16 * 1024, PACKAGE_BUDGET = 4 * 1024 * 1024
const IDENTIFIER = /^(?:[A-Za-z][A-Za-z0-9_]*|_[A-Za-z0-9_]+)$/
const identifier = (value: string) => value.length <= 128 && IDENTIFIER.exec(value)?.[0] === value
function decode<C extends Codec>(codec: C, bytes: Uint8Array): ReturnType<C['parse']> {
  const result = codec.parse(bytes)
  check(toBase64(codec.serialize(result).toBytes()) === toBase64(bytes), 'NONCANONICAL_BCS')
  return result
}
function digest(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
    && fromBase58(value).length === 32 && toBase58(fromBase58(value)) === value, 'INVALID_OBJECT_DIGEST')
}
function objectHash(bytes: Uint8Array) {
  const prefix = new TextEncoder().encode('Object::'), input = new Uint8Array(prefix.length + bytes.length)
  input.set(prefix); input.set(bytes, prefix.length)
  return toBase58(blake2b(input, { dkLen: 32 }))
}
function deadline(signal?: AbortSignal) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(40000)]) : AbortSignal.timeout(40000)
}
async function chain(client: PrivateWalletBookmarksReadClient, deployment: PrivateWalletBookmarksDeployment, signal: AbortSignal) {
  const value = (await step(signal, () => client.core.getChainIdentifier())).chainIdentifier
  digest(value)
  check(toHex(fromBase58(value).subarray(0, 4)) === deployment.chainIdentifier, 'WRONG_CHAIN')
}
function fullObject(raw: Raw, objectId: string, maximum: number) {
  check(raw && raw.objectId === objectId && typeof raw.version === 'bigint' && raw.version > 0n && raw.version <= MAX_U64,
    'OBJECT_IDENTITY_MISMATCH')
  digest(raw.digest)
  check(raw.bcs?.value instanceof Uint8Array && raw.bcs.value.length > 0 && raw.bcs.value.length <= maximum, 'OBJECT_BYTE_BUDGET')
  const parsed = decode(bcs.Object, raw.bcs.value)
  check(objectHash(raw.bcs.value) === raw.digest, 'OBJECT_DIGEST_MISMATCH')
  return parsed as ReturnType<typeof bcs.Object.parse>
}
function validateRaw(raw: Raw, objectId: string, type: string, maximum: number, kind?: number, owner?: string) {
  const parsed = fullObject(raw, objectId, maximum + 512), move = parsed.data.Move
  check(move && move.type.Other && normalizeStructTag(TypeTagSerializer.tagToString({ struct: move.type.Other })) === normalizeStructTag(type)
    && raw.objectType === normalizeStructTag(type) && move.version === String(raw.version), 'OBJECT_TYPE_MISMATCH')
  check(move.contents.length > 0 && move.contents.length <= maximum
    && (raw.contents === undefined || raw.contents.value instanceof Uint8Array
      && toBase64(raw.contents.value) === toBase64(move.contents)), 'OBJECT_CONTENT_MISMATCH')
  const actual = parsed.owner
  const actualKind = actual.$kind === 'AddressOwner' ? 1 : actual.$kind === 'ObjectOwner' ? 2
    : actual.$kind === 'Shared' ? 3 : actual.$kind === 'Immutable' ? 4 : -1
  check(raw.owner && actualKind !== -1 && raw.owner.kind === actualKind && (kind === undefined || actualKind === kind), 'CUSTODY_MISMATCH')
  if (actualKind === 1 || actualKind === 2) {
    const address = actual.AddressOwner ?? actual.ObjectOwner
    id(address)
    check(raw.owner.address === address && (owner === undefined || address === owner), 'CUSTODY_MISMATCH')
  }
  if (actualKind === 3) {
    check(actual.Shared && BigInt(actual.Shared.initialSharedVersion) > 0n
      && BigInt(actual.Shared.initialSharedVersion) <= raw.version!
      && raw.owner.version === BigInt(actual.Shared.initialSharedVersion), 'SHARED_BIRTH_INVALID')
  }
  // Registry and Field have key but no store; a transferable substitute is not
  // the approved account-state schema even if its contents have the same bytes.
  if (kind === 3 || kind === 2) check(!move.hasPublicTransfer, 'PUBLIC_TRANSFER_MISMATCH')
  return move.contents
}
function sameRaw(a: Raw | null, b: Raw | null) {
  return a === null ? b === null : b !== null && a.objectId === b.objectId && a.objectType === b.objectType
    && a.version === b.version && a.digest === b.digest && a.owner?.kind === b.owner?.kind
    && a.owner?.address === b.owner?.address && a.owner?.version === b.owner?.version
    && toBase64(a.bcs!.value!) === toBase64(b.bcs!.value!)
}
async function packageAuthority(client: PrivateWalletBookmarksReadClient, deployment: PrivateWalletBookmarksDeployment, signal: AbortSignal) {
  const { response } = await step(signal, () => client.ledgerService.getObject({ objectId: deployment.callablePackageId,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'bcs', 'package.storage_id', 'package.original_id', 'package.version'] },
  }, { abort: signal }))
  const raw = structuredClone(response.object)
  check(raw && raw.digest === deployment.callableDigest, 'PACKAGE_REFERENCE_MISMATCH')
  const parsed = fullObject(raw, deployment.callablePackageId, PACKAGE_BUDGET), pkg = parsed.data.Package
  check(parsed.owner.$kind === 'Immutable' && raw.owner?.kind === 4
    && pkg?.id === deployment.callablePackageId && pkg.version === String(raw.version), 'PACKAGE_BCS_MISMATCH')
  // Some official ledgers omit these redundant projections. Supplied values
  // must agree; canonical full Object BCS/digest/type origins are authoritative.
  check((raw.package?.storageId === undefined || raw.package.storageId === pkg.id)
    && (raw.package?.originalId === undefined || raw.package.originalId === deployment.originalPackageId)
    && (raw.package?.version === undefined || raw.package.version === raw.version), 'PACKAGE_PROJECTION_MISMATCH')
  check(pkg.moduleMap.size > 0 && pkg.moduleMap.size <= 512 && pkg.typeOriginTable.length <= 4096
    && pkg.linkageTable.size <= 1024, 'PACKAGE_TABLE_BUDGET')
  for (const [name, module] of pkg.moduleMap) check(identifier(name) && module.length > 0, 'PACKAGE_MODULE_INVALID')
  for (const [original, link] of pkg.linkageTable) {
    id(original); id(link.upgradedId); assertPrivateWalletBookmarksU64(link.upgradedVersion)
  }
  const origins = new Map<string, string>()
  for (const origin of pkg.typeOriginTable) {
    const key = `${origin.moduleName}::${origin.datatypeName}`
    check(identifier(origin.moduleName) && identifier(origin.datatypeName) && pkg.moduleMap.has(origin.moduleName)
      && !origins.has(key), 'PACKAGE_ORIGIN_INVALID')
    id(origin.package); origins.set(key, origin.package)
  }
  for (const name of ['ProfileRegistryV1', 'BookmarksHeadKeyV1', 'BookmarksCipherRefV1',
    'BookmarksReceiptV1', 'BookmarksHeadV1', 'BookmarksSealScopeV1']) {
    check(origins.get(`profile::${name}`) === deployment.originalPackageId, 'PACKAGE_TYPE_ORIGIN_MISMATCH')
  }
}
function cipher(value: { blob_object_id: string; blob_id: string; sha256: number[]; byte_length: string }) {
  return assertPrivateWalletBookmarksCipherRef({ blobObjectId: value.blob_object_id, blobId: value.blob_id,
    sha256: toHex(new Uint8Array(value.sha256)), byteLength: value.byte_length })
}
function sameCipher(a: Readonly<PrivateWalletBookmarksCipherRef>, b: Readonly<PrivateWalletBookmarksCipherRef>) {
  return a.blobObjectId === b.blobObjectId && a.blobId === b.blobId && a.sha256 === b.sha256 && a.byteLength === b.byteLength
}

/** Raw trusted-ledger evidence, not validator quorum authentication. Only an
 * explicit NOT_FOUND for the exact derived field, reread with the same stable
 * shared registry, is ABSENT. No public Profile, asset or indexer is consulted. */
export async function readPrivateWalletBookmarksHead(params: PrivateWalletBookmarksReadParams): Promise<Readonly<PrivateWalletBookmarksHeadSnapshot>> {
  const deployment = assertPrivateWalletBookmarksDeployment(params.deployment), scope = assertPrivateWalletBookmarksScope(params.scope)
  const client = params.client, signal = deadline(params.signal), pkg = deployment.originalPackageId
  await chain(client, deployment, signal)
  await packageAuthority(client, deployment, signal)
  const seen = new Map<string, Raw | null>()
  async function read(objectId: string, type: string, maximum: number, kind: number, owner?: string, optional = false) {
    const { response } = await step(signal, () => client.ledgerService.batchGetObjects({ requests: [{ objectId }],
      readMask: { paths: MASK } }, { abort: signal }))
    check(response?.objects?.length === 1, 'INCOMPLETE_RESPONSE')
    const result = response.objects[0].result
    check(result?.oneofKind === 'object' || optional && result?.oneofKind === 'error' && result.error.code === 5, 'OBJECT_UNAVAILABLE')
    const raw = result.oneofKind === 'object' ? structuredClone(result.object) : null
    const content = raw ? validateRaw(raw, objectId, type, maximum, kind, owner) : null
    if (seen.has(objectId)) check(sameRaw(seen.get(objectId)!, raw), 'CHANGED_RETRY')
    else seen.set(objectId, raw)
    return { raw, content }
  }
  const registryType = `${pkg}::profile::ProfileRegistryV1`
  const registryRead = await read(scope.registryId, registryType, 512, 3)
  const registryRaw = registryRead.raw!, registry = decode(ProfileRegistryV1Bcs, registryRead.content!)
  check(registry.id === scope.registryId && registry.version === '1', 'REGISTRY_MISMATCH')
  for (const table of [registry.by_owner, registry.by_handle, registry.by_index]) id(table.id)
  check(new Set([registry.id, registry.by_owner.id, registry.by_handle.id, registry.by_index.id]).size === 4
    && registry.by_owner.size === registry.profile_count && registry.by_index.size === registry.profile_count
    && BigInt(registry.by_handle.size) <= BigInt(registry.profile_count), 'REGISTRY_DIRECTORY_MISMATCH')
  const headFieldId = derivePrivateWalletBookmarksHeadFieldId(pkg, scope)
  const headType = `0x2::dynamic_field::Field<${pkg}::profile::BookmarksHeadKeyV1,${pkg}::profile::BookmarksHeadV1>`
  const headRead = await read(headFieldId, headType, HEAD_BUDGET, 2, scope.registryId, true)
  const headRaw = headRead.raw
  let head: Readonly<PrivateWalletBookmarksHead> | null = null
  if (headRaw) {
    const field = decode(PrivateWalletBookmarksHeadFieldV1Bcs, headRead.content!), h = field.value
    check(field.id === headFieldId && field.name.version === 1 && field.name.owner === scope.owner
      && h.version === 1 && h.registry_id === scope.registryId && h.owner === scope.owner && BigInt(h.revision) > 0n, 'HEAD_SCOPE_MISMATCH')
    const ciphertext = cipher(h.ciphertext)
    check(h.receipts.length > 0 && h.receipts.length <= PRIVATE_WALLET_BOOKMARKS_MAX_RECEIPTS
      && BigInt(h.receipts.length) === (BigInt(h.revision) < 32n ? BigInt(h.revision) : 32n), 'RECEIPT_WINDOW_MISMATCH')
    const receipts = h.receipts.map((row, index): Readonly<PrivateWalletBookmarksReceipt> => {
      const requestId = toHex(new Uint8Array(row.request_id)); assertPrivateWalletBookmarksHash(requestId)
      check(BigInt(row.revision) === BigInt(h.revision) - BigInt(h.receipts.length - index - 1), 'RECEIPT_REVISION_MISMATCH')
      return Object.freeze({ requestId, revision: row.revision, ciphertext: cipher(row.ciphertext) })
    })
    check(new Set(receipts.map(row => row.requestId)).size === receipts.length
      && sameCipher(receipts[receipts.length - 1].ciphertext, ciphertext), 'RECEIPT_HEAD_MISMATCH')
    head = Object.freeze({ scope, revision: h.revision, ciphertext, receipts: Object.freeze(receipts) })
  }
  await read(headFieldId, headType, HEAD_BUDGET, 2, scope.registryId, true)
  await read(scope.registryId, registryType, 512, 3)
  signal.throwIfAborted()
  return Object.freeze({ scope, revision: head?.revision ?? '0', head, emptyReason: head ? null : 'ABSENT',
    registryVersion: String(registryRaw.version), registryDigest: registryRaw.digest!, headFieldId,
    headFieldVersion: headRaw ? String(headRaw.version) : null, headFieldDigest: headRaw?.digest ?? null })
}

function storage(input: PrivateWalletBookmarksStorage): Readonly<PrivateWalletBookmarksStorage> {
  const value = structuredClone(input)
  check(value && typeof value.blobType === 'string' && /^0x[0-9a-f]{64}::blob::Blob$/.test(value.blobType)
    && !value.blobType.startsWith(`0x${'0'.repeat(64)}::`), 'INVALID_BLOB_TYPE')
  check(typeof value.aggregatorUrl === 'string', 'INVALID_STORAGE_URL')
  const url = new URL(value.aggregatorUrl)
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'INVALID_STORAGE_URL')
  return Object.freeze({ blobType: value.blobType, aggregatorUrl: url.href.replace(/\/$/, '') })
}

/** Ciphertext only. No Seal key, Soul ID, name, count or private intent leaves
 * this reader. The caller separately decrypts and validates its private schema. */
export async function readPrivateWalletBookmarksCiphertext(params: PrivateWalletBookmarksCiphertextReadParams): Promise<{
  snapshot: Readonly<PrivateWalletBookmarksHeadSnapshot>
  ciphertext: Uint8Array | null
  storageEndEpoch: number | null
}> {
  const deployment = assertPrivateWalletBookmarksDeployment(params.deployment), scope = assertPrivateWalletBookmarksScope(params.scope)
  const target = storage(params.storage), client = params.client, fetcher = params.fetcher ?? fetch
  const freshWalrusState = params.freshWalrusState, signal = deadline(params.signal)
  check(typeof freshWalrusState === 'function', 'FRESH_WALRUS_STATE_REQUIRED')
  async function epoch() {
    const current = await step(signal, () => freshWalrusState(signal))
    check(current && current.blobType === target.blobType && Number.isInteger(current.epoch)
      && current.epoch >= 0 && current.epoch <= 0xffff_ffff, 'WALRUS_STATE_MISMATCH')
    return current.epoch
  }
  const beforeEpoch = await epoch()
  const snapshot = await readPrivateWalletBookmarksHead({ client, deployment, scope, signal })
  if (!snapshot.head) return { snapshot, ciphertext: null, storageEndEpoch: null }
  const ref = snapshot.head.ciphertext
  async function blob(currentEpoch: number) {
    const { response } = await step(signal, () => client.ledgerService.getObject({ objectId: ref.blobObjectId,
      readMask: { paths: MASK } }, { abort: signal }))
    const raw = structuredClone(response.object)
    check(raw, 'BLOB_UNAVAILABLE')
    const content = validateRaw(raw, ref.blobObjectId, target.blobType, 256)
    const value = decode(ProfileWalrusBlobBcs, content)
    const blobId = toBase64(bcs.u256().serialize(value.blob_id).toBytes()).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    check(value.id === ref.blobObjectId && blobId === ref.blobId && value.size === ref.byteLength
      && value.encoding_type === 1, 'BLOB_CONTENT_MISMATCH')
    id(value.storage.id)
    check(value.storage.id !== value.id && value.storage.start_epoch <= value.registered_epoch
      && value.registered_epoch <= currentEpoch && value.storage.start_epoch < value.storage.end_epoch
      && BigInt(value.storage.storage_size) > 0n, 'BLOB_STORAGE_MISMATCH')
    check(value.certified_epoch !== null && value.certified_epoch >= value.registered_epoch
      && value.certified_epoch >= value.storage.start_epoch && value.certified_epoch <= currentEpoch
      && value.certified_epoch < value.storage.end_epoch, 'BLOB_NOT_CERTIFIED')
    check(currentEpoch < value.storage.end_epoch, 'STORAGE_EXPIRED')
    return { raw, endEpoch: value.storage.end_epoch }
  }
  const beforeBlob = await blob(beforeEpoch)
  signal.throwIfAborted()
  let received: Response | undefined, discarded = false
  const discard = (value: Response) => {
    if (!discarded) { discarded = true; void value.body?.cancel().catch(() => {}) }
  }
  const pending = fetcher(`${target.aggregatorUrl}/v1/blobs/${ref.blobId}`, {
    credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
  }).then(value => { received = value; if (signal.aborted) discard(value); return value })
  void pending.catch(() => {})
  let response: Response
  try { response = await step(signal, () => pending, discard); signal.throwIfAborted() }
  catch (error) { if (received) discard(received); throw error }
  let ciphertext: Uint8Array | null = null, bodyOwned = false
  try {
    check(response.ok && response.body, 'STORAGE_UNAVAILABLE')
    const expected = Number(ref.byteLength), declared = response.headers.get('content-length')
    check(declared === null || declared.length <= 20 && /^(0|[1-9][0-9]*)$/.test(declared)
      && BigInt(declared) === BigInt(ref.byteLength), 'CIPHERTEXT_LENGTH_MISMATCH')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    bodyOwned = true
    let length = 0
    try {
      for (;;) {
        const result = await step(signal, () => reader.read())
        if (result.done) break
        check(result.value instanceof Uint8Array, 'INVALID_STORAGE_CHUNK')
        length += result.value.length
        check(length <= expected, 'CIPHERTEXT_LENGTH_MISMATCH')
        chunks.push(result.value)
      }
      check(length === expected, 'CIPHERTEXT_LENGTH_MISMATCH')
      ciphertext = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { ciphertext.set(chunk, offset); offset += chunk.length }
    } catch (error) { void reader.cancel().catch(() => {}); throw error }
    finally { reader.releaseLock() }
    const hash = toHex(new Uint8Array(await step(signal, () => crypto.subtle.digest('SHA-256', new Uint8Array(ciphertext!)))))
    check(hash === ref.sha256, 'CIPHERTEXT_DIGEST_MISMATCH')
    const afterEpoch = await epoch()
    check(afterEpoch >= beforeEpoch, 'WALRUS_EPOCH_REGRESSION')
    const afterBlob = await blob(afterEpoch)
    check(sameRaw(beforeBlob.raw, afterBlob.raw), 'BLOB_CHANGED_RETRY')
    const afterHead = await readPrivateWalletBookmarksHead({ client, deployment, scope, signal })
    check(JSON.stringify(afterHead) === JSON.stringify(snapshot), 'CHANGED_RETRY')
    signal.throwIfAborted()
    return { snapshot, ciphertext, storageEndEpoch: afterBlob.endEpoch }
  } catch (error) {
    ciphertext?.fill(0)
    if (!bodyOwned) discard(response)
    throw error
  }
}
