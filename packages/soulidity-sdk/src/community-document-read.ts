import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, fromBase64, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { ProfileWalrusBlobBcs } from './public-profile-metadata'
import { profileReadStep as step } from './profile-read-step'
import { COMMUNITY_DOCUMENT_MAX_BYTES, decodePublicCommunityDocument } from './community-document'

export interface PublicCommunityDocumentRef {
  blobObjectId: string; blobId: string; sha256: string; byteLength: string
}
export interface PublicCommunityStorageTarget { blobType: string; aggregatorUrl: string; chainIdentifier: string }
export interface PublicCommunityStorageClient {
  core: Pick<SuiGrpcClient['core'], 'getChainIdentifier'>
  ledgerService: Pick<SuiGrpcClient['ledgerService'], 'getObject'>
}
/** Same verified network/client as the ledger. Reset the Walrus SDK cache before
 * systemState(); a Sui epoch, upload receipt or cached epoch is not a substitute. */
export type FreshCommunityWalrusState = (signal: AbortSignal) => Promise<{ blobType: string; epoch: number }>
const MAX_U64 = 18446744073709551615n
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`COMMUNITY_STORAGE_${code}`) }
const id = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
const blobText = (bytes: Uint8Array) => toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
export function assertPublicCommunityDocumentRef(input: PublicCommunityDocumentRef): PublicCommunityDocumentRef {
  const value = structuredClone(input)
  check(value && id(value.blobObjectId) && typeof value.blobId === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(value.blobId), 'REFERENCE_INVALID')
  const bytes = fromBase64(value.blobId.replaceAll('-', '+').replaceAll('_', '/') + '=')
  check(bytes.length === 32 && blobText(bytes) === value.blobId && /^[0-9a-f]{64}$/.test(value.sha256)
    && typeof value.byteLength === 'string' && /^[1-9][0-9]{0,19}$/.test(value.byteLength)
    && BigInt(value.byteLength) <= MAX_U64, 'REFERENCE_INVALID')
  return value
}
function target(input: PublicCommunityStorageTarget) {
  const value = structuredClone(input)
  check(value && typeof value.blobType === 'string' && /^0x[0-9a-f]{64}::blob::Blob$/.test(value.blobType)
    && id(value.blobType.split('::')[0]) && /^[0-9a-f]{8}$/.test(value.chainIdentifier), 'TARGET_INVALID')
  check(typeof value.aggregatorUrl === 'string', 'TARGET_INVALID')
  const url = new URL(value.aggregatorUrl)
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'URL_INVALID')
  return { ...value, aggregatorUrl: url.href.replace(/\/$/, '') }
}
function digest(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
    && fromBase58(value).length === 32 && toBase58(fromBase58(value)) === value, 'DIGEST_INVALID')
}

/** Verifies storage only, not authorship or directory membership. Call with an
 * exact chain-read reference; callers must pin/recheck their mutable Post state.
 * RPC evidence is trusted-ledger evidence, not an independent quorum proof. */
export async function readPublicCommunityDocument(params: {
  client: PublicCommunityStorageClient; reference: PublicCommunityDocumentRef
  storage: PublicCommunityStorageTarget; freshWalrusState: FreshCommunityWalrusState
  kind: 'post' | 'comment'; signal?: AbortSignal; fetcher?: typeof fetch
}) {
  const ref = assertPublicCommunityDocumentRef(params.reference), storage = target(params.storage)
  const { client, freshWalrusState, kind, fetcher = fetch } = params
  check(kind === 'post' || kind === 'comment', 'KIND_INVALID')
  check(BigInt(ref.byteLength) <= BigInt(COMMUNITY_DOCUMENT_MAX_BYTES), 'BYTE_LIMIT')
  check(typeof freshWalrusState === 'function', 'FRESH_STATE_REQUIRED')
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
  const chain = (await step(signal, () => client.core.getChainIdentifier())).chainIdentifier
  digest(chain)
  check(toHex(fromBase58(chain).subarray(0, 4)) === storage.chainIdentifier, 'WRONG_CHAIN')
  async function epoch() {
    const state = await step(signal, () => freshWalrusState(signal))
    check(state && state.blobType === storage.blobType && Number.isInteger(state.epoch)
      && state.epoch >= 0 && state.epoch <= 0xffff_ffff, 'WALRUS_STATE_MISMATCH')
    return state.epoch
  }
  async function blob(currentEpoch: number) {
    const { response } = await step(signal, () => client.ledgerService.getObject({ objectId: ref.blobObjectId,
      readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'contents'] } }, { abort: signal }))
    const raw = structuredClone(response.object)
    check(raw && raw.objectId === ref.blobObjectId && raw.objectType === storage.blobType
      && typeof raw.version === 'bigint' && raw.version > 0n && raw.version <= MAX_U64, 'BLOB_IDENTITY_MISMATCH')
    digest(raw.digest)
    const bytes = raw.contents?.value
    check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 256, 'BLOB_BYTES_INVALID')
    const value = ProfileWalrusBlobBcs.parse(bytes)
    check(toBase64(ProfileWalrusBlobBcs.serialize(value).toBytes()) === toBase64(bytes)
      && value.id === ref.blobObjectId && blobText(bcs.u256().serialize(value.blob_id).toBytes()) === ref.blobId
      && value.size === ref.byteLength && value.encoding_type === 1, 'BLOB_CONTENT_MISMATCH')
    check(id(value.storage.id) && value.storage.id !== value.id && value.storage.start_epoch <= value.registered_epoch
      && value.registered_epoch <= currentEpoch && value.storage.start_epoch < value.storage.end_epoch
      && BigInt(value.storage.storage_size) > 0n, 'BLOB_STORAGE_MISMATCH')
    check(value.certified_epoch !== null && value.certified_epoch >= value.registered_epoch
      && value.certified_epoch >= value.storage.start_epoch && value.certified_epoch <= currentEpoch
      && value.certified_epoch < value.storage.end_epoch, 'BLOB_NOT_CERTIFIED')
    check(currentEpoch < value.storage.end_epoch, 'EXPIRED')
    return { identity: `${raw.version}:${raw.digest}:${toBase64(bytes)}`, endEpoch: value.storage.end_epoch }
  }
  const beforeEpoch = await epoch(), before = await blob(beforeEpoch)
  const response = await step(signal, () => fetcher(`${storage.aggregatorUrl}/v1/blobs/${ref.blobId}`, {
    credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
  }), late => { void late.body?.cancel().catch(() => {}) })
  let bodyOwned = false
  try {
    check(response.ok && response.body, 'UNAVAILABLE')
    const declared = response.headers.get('content-length')
    check(declared === null || declared.length <= 20 && /^(0|[1-9][0-9]*)$/.test(declared)
      && declared === ref.byteLength, 'LENGTH_MISMATCH')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    bodyOwned = true
    let length = 0
    try {
      for (;;) {
        const row = await step(signal, () => reader.read())
        if (row.done) break
        check(row.value instanceof Uint8Array, 'CHUNK_INVALID')
        length += row.value.length
        check(length <= Number(ref.byteLength), 'LENGTH_MISMATCH')
        chunks.push(row.value)
      }
      check(length === Number(ref.byteLength), 'LENGTH_MISMATCH')
    } catch (error) { void reader.cancel().catch(() => {}); throw error }
    finally { reader.releaseLock() }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const hash = toHex(new Uint8Array(await step(signal, () => crypto.subtle.digest('SHA-256', bytes))))
    check(hash === ref.sha256, 'HASH_MISMATCH')
    const document = decodePublicCommunityDocument(bytes)
    check(document.schema === `soulidity.public-${kind}.v1`, 'KIND_MISMATCH')
    const afterEpoch = await epoch()
    check(afterEpoch >= beforeEpoch, 'EPOCH_REGRESSION')
    const after = await blob(afterEpoch)
    check(before.identity === after.identity, 'BLOB_CHANGED_RETRY')
    signal.throwIfAborted()
    return { document, storageEndEpoch: after.endEpoch }
  } catch (error) {
    if (!bodyOwned) void response.body?.cancel().catch(() => {})
    throw error
  }
}
