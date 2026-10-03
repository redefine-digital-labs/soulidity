import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep as step } from './profile-read-step'
import { deriveKioskItemFieldId, assertKioskItemField, KIOSK_ITEM_FIELD_TYPE, KIOSK_ITEM_FIELD_BYTES } from './kiosk-item-custody'
import { ProfileWalrusBlobBcs } from './public-profile-metadata'
import { SoulPublicBcs, SoulStatePublicBcs, SoulStatePointerKeyV1Bcs, SoulStatePointerFieldV1Bcs,
  SOUL_PUBLIC_MAX_SOUL_BYTES } from './soul-public-read'
import { assertPrivateNamedLoadoutCapture, assertPrivateNamedLoadoutCipherRef,
  assertPrivateNamedLoadoutDeployment, assertPrivateNamedLoadoutHash, assertPrivateNamedLoadoutId as id,
  assertPrivateNamedLoadoutScope, derivePrivateNamedLoadoutHeadFieldId,
  privateNamedLoadoutCheck as check, PRIVATE_NAMED_LOADOUT_MAX_U64 as MAX_U64,
  PRIVATE_NAMED_LOADOUT_MAX_RECEIPTS, PrivateNamedLoadoutHeadFieldV1Bcs,
  type PrivateNamedLoadoutCipherRef, type PrivateNamedLoadoutDeployment, type PrivateNamedLoadoutHead,
  type PrivateNamedLoadoutReceipt, type PrivateNamedLoadoutScope } from './private-named-loadout'

export interface PrivateNamedLoadoutReadClient {
  core: Pick<SuiGrpcClient['core'], 'getChainIdentifier'>
  ledgerService: Pick<SuiGrpcClient['ledgerService'], 'getObject' | 'batchGetObjects'>
}
export interface PrivateNamedLoadoutReadParams {
  client: PrivateNamedLoadoutReadClient
  deployment: PrivateNamedLoadoutDeployment
  scope: PrivateNamedLoadoutScope
  signal?: AbortSignal
}
export interface PrivateNamedLoadoutHeadSnapshot {
  scope: Readonly<PrivateNamedLoadoutScope>
  revision: string
  head: Readonly<PrivateNamedLoadoutHead> | null
  emptyReason: 'ABSENT' | 'PRIOR_EPOCH' | null
  stateVersion: string
  stateDigest: string
  headFieldId: string
  headFieldVersion: string | null
  headFieldDigest: string | null
}
export interface PrivateNamedLoadoutStorage {
  blobType: string
  aggregatorUrl: string
}
/** Bind this capability to the reader's SAME verified gRPC client and public
 * Walrus network configuration. The browser adapter must reset the Walrus SDK
 * cache before systemState(); an uploaded/cached/Sui epoch is not current proof. */
export type FreshPrivateNamedLoadoutWalrusState = (signal: AbortSignal) => Promise<{
  blobType: string
  epoch: number
}>
export interface PrivateNamedLoadoutCiphertextReadParams extends PrivateNamedLoadoutReadParams {
  storage: PrivateNamedLoadoutStorage
  freshWalrusState: FreshPrivateNamedLoadoutWalrusState
  fetcher?: typeof fetch
}

type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
type Raw = NonNullable<Awaited<ReturnType<PrivateNamedLoadoutReadClient['ledgerService']['getObject']>>['response']['object']>
const MASK = ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents']
const HEAD_BUDGET = 16 * 1024
function decode<C extends Codec>(codec: C, bytes: Uint8Array): ReturnType<C['parse']> {
  const result = codec.parse(bytes)
  check(toBase64(codec.serialize(result).toBytes()) === toBase64(bytes), 'NONCANONICAL_BCS')
  return result
}
function digest(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
    && fromBase58(value).length === 32 && toBase58(fromBase58(value)) === value, 'INVALID_OBJECT_DIGEST')
}
function deadline(signal?: AbortSignal) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(40000)]) : AbortSignal.timeout(40000)
}
async function chain(client: PrivateNamedLoadoutReadClient, target: PrivateNamedLoadoutDeployment, signal: AbortSignal) {
  const value = (await step(signal, () => client.core.getChainIdentifier())).chainIdentifier
  digest(value)
  check(toHex(fromBase58(value).subarray(0, 4)) === target.chainIdentifier, 'WRONG_CHAIN')
}
function validateRaw(raw: Raw, objectId: string, type: string, maximum: number, kind?: number, owner?: string) {
  check(raw && raw.objectId === objectId && raw.objectType === normalizeStructTag(type)
    && typeof raw.version === 'bigint' && raw.version > 0n && raw.version <= MAX_U64, 'OBJECT_IDENTITY_MISMATCH')
  digest(raw.digest)
  check(raw.owner && typeof raw.owner.kind === 'number' && [1, 2, 3, 4].includes(raw.owner.kind)
    && (kind === undefined || raw.owner.kind === kind) && (owner === undefined || raw.owner.address === owner), 'CUSTODY_MISMATCH')
  if (raw.owner.kind === 1 || raw.owner.kind === 2) id(raw.owner.address)
  if (raw.owner.kind === 3) check(typeof raw.owner.version === 'bigint' && raw.owner.version > 0n
    && raw.owner.version <= raw.version, 'SHARED_BIRTH_INVALID')
  check(raw.contents?.value instanceof Uint8Array && raw.contents.value.length > 0
    && raw.contents.value.length <= maximum, 'OBJECT_BYTE_BUDGET')
}
function sameRaw(a: Raw | null, b: Raw | null) {
  return a === null ? b === null : b !== null && a.objectId === b.objectId && a.objectType === b.objectType
    && a.version === b.version && a.digest === b.digest && a.owner?.kind === b.owner?.kind
    && a.owner?.address === b.owner?.address && a.owner?.version === b.owner?.version
    && toBase64(a.contents!.value!) === toBase64(b.contents!.value!)
}
function cipher(value: { blob_object_id: string; blob_id: string; sha256: number[]; byte_length: string }) {
  return assertPrivateNamedLoadoutCipherRef({ blobObjectId: value.blob_object_id, blobId: value.blob_id,
    sha256: toHex(new Uint8Array(value.sha256)), byteLength: value.byte_length })
}
function sameCipher(a: Readonly<PrivateNamedLoadoutCipherRef>, b: Readonly<PrivateNamedLoadoutCipherRef>) {
  return a.blobObjectId === b.blobObjectId && a.blobId === b.blobId && a.sha256 === b.sha256 && a.byteLength === b.byteLength
}

/** Only a raw NOT_FOUND for the derived constant key, or a fully decoded prior
 * epoch, is empty. Reread the complete identity/head set, including absence. */
export async function readPrivateNamedLoadoutHead(params: PrivateNamedLoadoutReadParams): Promise<Readonly<PrivateNamedLoadoutHeadSnapshot>> {
  const deployment = assertPrivateNamedLoadoutDeployment(params.deployment), scope = assertPrivateNamedLoadoutScope(params.scope)
  const client = params.client, signal = deadline(params.signal), pkg = deployment.originalPackageId
  await chain(client, deployment, signal)
  const seen = new Map<string, { raw: Raw | null; type: string; maximum: number; kind: number; owner?: string; optional: boolean }>()
  let totalBytes = 0
  async function read(objectId: string, type: string, maximum: number, kind: number, owner?: string, optional = false): Promise<Raw | null> {
    const { response } = await step(signal, () => client.ledgerService.batchGetObjects({ requests: [{ objectId }], readMask: { paths: MASK } }, { abort: signal }))
    check(response?.objects?.length === 1, 'INCOMPLETE_RESPONSE')
    const result = response.objects[0].result
    check(result?.oneofKind === 'object' || optional && result?.oneofKind === 'error' && result.error.code === 5, 'OBJECT_UNAVAILABLE')
    const raw = result.oneofKind === 'object' ? structuredClone(result.object) : null
    if (raw) {
      validateRaw(raw, objectId, type, maximum, kind, owner)
      totalBytes += raw.contents!.value!.length
      check(totalBytes <= 1024 * 1024, 'READ_BYTE_BUDGET')
    }
    const prior = seen.get(objectId)
    if (prior) check(sameRaw(prior.raw, raw), 'CHANGED_RETRY')
    else seen.set(objectId, { raw, type, maximum, kind, owner, optional })
    return raw
  }
  const stateRaw = (await read(scope.stateId, `${pkg}::soul::SoulState`, 8192, 3))!
  const state = decode(SoulStatePublicBcs, stateRaw.contents!.value!)
  check(state.id === scope.stateId && state.version === '1' && state.soul_id === scope.soulId, 'STATE_MISMATCH')
  check(state.current_owner === scope.owner && state.ownership_epoch === scope.ownershipEpoch, 'OWNER_EPOCH_CHANGED')
  for (const value of [state.creator, state.current_kiosk_id, state.active_grants.id, state.active_grant_ids.id, state.config_ext.id]) id(value)
  if (state.content_id !== null) id(state.content_id)
  if (state.collection_id !== null) id(state.collection_id)
  if (state.access_list_id !== null) id(state.access_list_id)
  check(state.creator_royalty_bps <= 10000 && BigInt(state.active_grant_count) <= BigInt(state.grant_capacity)
    && BigInt(state.active_grant_count) <= BigInt(state.active_grants.size)
    && state.active_grants.size === state.active_grant_ids.size, 'STATE_COUNTER_MISMATCH')
  check(new Set([state.id, state.soul_id, state.current_kiosk_id, state.active_grants.id, state.active_grant_ids.id, state.config_ext.id]).size === 6,
    'STATE_ALIAS')
  const keyType = `${pkg}::soul::SoulStatePointerKeyV1`
  const pointerId = deriveDynamicFieldID(scope.soulId, keyType, SoulStatePointerKeyV1Bcs.serialize({ version: 1 }).toBytes())
  const pointerRaw = (await read(pointerId, `0x2::dynamic_field::Field<${keyType},0x2::object::ID>`, 65, 2, scope.soulId))!
  const pointer = decode(SoulStatePointerFieldV1Bcs, pointerRaw.contents!.value!)
  check(pointer.id === pointerId && pointer.name.version === 1 && pointer.value === scope.stateId, 'STATE_POINTER_MISMATCH')
  const itemFieldId = deriveKioskItemFieldId(state.current_kiosk_id, scope.soulId)
  const itemField = (await read(itemFieldId, KIOSK_ITEM_FIELD_TYPE, KIOSK_ITEM_FIELD_BYTES, 2, state.current_kiosk_id))!
  assertKioskItemField(itemField.contents!.value!, state.current_kiosk_id, scope.soulId)
  const soulRaw = (await read(scope.soulId, `${pkg}::soul::Soul`, SOUL_PUBLIC_MAX_SOUL_BYTES, 2, itemFieldId))!
  const soul = decode(SoulPublicBcs, soulRaw.contents!.value!)
  check(soul.id === scope.soulId && soul.version === '1' && soul.creator === state.creator
    && [0, 1, 2, 3].includes(soul.provenance_kind), 'SOUL_MISMATCH')
  const headFieldId = derivePrivateNamedLoadoutHeadFieldId(pkg, scope.stateId)
  const headType = `0x2::dynamic_field::Field<${pkg}::soul::NamedLoadoutHeadKeyV1,${pkg}::named_loadout_v1::HeadV1>`
  const headRaw = await read(headFieldId, headType, HEAD_BUDGET, 2, scope.stateId, true)
  let head: Readonly<PrivateNamedLoadoutHead> | null = null
  let emptyReason: PrivateNamedLoadoutHeadSnapshot['emptyReason'] = 'ABSENT'
  if (headRaw) {
    const field = decode(PrivateNamedLoadoutHeadFieldV1Bcs, headRaw.contents!.value!), h = field.value
    check(field.id === headFieldId && field.name.version === 1 && h.version === 1
      && h.soul_id === scope.soulId && h.state_id === scope.stateId && BigInt(h.revision) > 0n
      && BigInt(h.ownership_epoch) <= BigInt(scope.ownershipEpoch), 'HEAD_SCOPE_MISMATCH')
    id(h.owner)
    const ciphertext = cipher(h.ciphertext)
    check(h.receipts.length > 0 && h.receipts.length <= PRIVATE_NAMED_LOADOUT_MAX_RECEIPTS
      && BigInt(h.receipts.length) === (BigInt(h.revision) < 32n ? BigInt(h.revision) : 32n), 'RECEIPT_WINDOW_MISMATCH')
    const receipts = h.receipts.map((row, index): Readonly<PrivateNamedLoadoutReceipt> => {
      const requestId = toHex(new Uint8Array(row.request_id)); assertPrivateNamedLoadoutHash(requestId)
      check(BigInt(row.revision) === BigInt(h.revision) - BigInt(h.receipts.length - index - 1), 'RECEIPT_REVISION_MISMATCH')
      const capture = row.capture === null ? null : assertPrivateNamedLoadoutCapture({ equipmentId: row.capture.equipment_id,
        revision: row.capture.revision, commitment: toHex(new Uint8Array(row.capture.commitment)) })
      return Object.freeze({ requestId, revision: row.revision, ciphertext: cipher(row.ciphertext), capture })
    })
    check(new Set(receipts.map(row => row.requestId)).size === receipts.length
      && sameCipher(receipts[receipts.length - 1].ciphertext, ciphertext), 'RECEIPT_HEAD_MISMATCH')
    if (h.ownership_epoch === scope.ownershipEpoch) {
      check(h.owner === scope.owner, 'HEAD_OWNER_MISMATCH')
      head = Object.freeze({ scope, revision: h.revision, ciphertext, receipts: Object.freeze(receipts) })
      emptyReason = null
    } else emptyReason = 'PRIOR_EPOCH'
  }
  for (const [objectId, prior] of seen) {
    if (objectId !== scope.stateId) await read(objectId, prior.type, prior.maximum, prior.kind, prior.owner, prior.optional)
  }
  await read(scope.stateId, `${pkg}::soul::SoulState`, 8192, 3)
  signal.throwIfAborted()
  return Object.freeze({ scope, revision: head?.revision ?? '0', head, emptyReason, stateVersion: String(stateRaw.version),
    stateDigest: stateRaw.digest!, headFieldId, headFieldVersion: headRaw ? String(headRaw.version) : null,
    headFieldDigest: headRaw?.digest ?? null })
}

function storage(input: PrivateNamedLoadoutStorage): Readonly<PrivateNamedLoadoutStorage> {
  const value = structuredClone(input)
  check(value && typeof value.blobType === 'string' && /^0x[0-9a-f]{64}::blob::Blob$/.test(value.blobType)
    && !value.blobType.startsWith(`0x${'0'.repeat(64)}::`), 'INVALID_BLOB_TYPE')
  check(typeof value.aggregatorUrl === 'string', 'INVALID_STORAGE_URL')
  const url = new URL(value.aggregatorUrl)
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'INVALID_STORAGE_URL')
  return Object.freeze({ blobType: value.blobType, aggregatorUrl: url.href.replace(/\/$/, '') })
}

/** Ciphertext only. No Seal keys, names, entry counts or decrypted library leave
 * this reader. The caller validates/decrypts its envelope separately. */
export async function readPrivateNamedLoadoutCiphertext(params: PrivateNamedLoadoutCiphertextReadParams): Promise<{
  snapshot: Readonly<PrivateNamedLoadoutHeadSnapshot>
  ciphertext: Uint8Array | null
  storageEndEpoch: number | null
}> {
  const deployment = assertPrivateNamedLoadoutDeployment(params.deployment), scope = assertPrivateNamedLoadoutScope(params.scope)
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
  const snapshot = await readPrivateNamedLoadoutHead({ client, deployment, scope, signal })
  if (!snapshot.head) return { snapshot, ciphertext: null, storageEndEpoch: null }
  const ref = snapshot.head.ciphertext
  async function blob(currentEpoch: number) {
    const { response } = await step(signal, () => client.ledgerService.getObject({ objectId: ref.blobObjectId, readMask: { paths: MASK } }, { abort: signal }))
    const raw = structuredClone(response.object)
    check(raw, 'BLOB_UNAVAILABLE')
    validateRaw(raw, ref.blobObjectId, target.blobType, 256)
    const value = decode(ProfileWalrusBlobBcs, raw.contents!.value!)
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
  }).then(value => {
    received = value
    if (signal.aborted) discard(value)
    return value
  })
  // Own both late transport rejection and the resolved response across every
  // microtask between fetch, the cancellation race and reader acquisition.
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
    const afterHead = await readPrivateNamedLoadoutHead({ client, deployment, scope, signal })
    check(JSON.stringify(afterHead) === JSON.stringify(snapshot), 'CHANGED_RETRY')
    signal.throwIfAborted()
    return { snapshot, ciphertext, storageEndEpoch: afterBlob.endEpoch }
  } catch (error) {
    ciphertext?.fill(0)
    if (!bodyOwned) discard(response)
    throw error
  }
}
