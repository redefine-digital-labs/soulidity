import { bcs } from '@mysten/sui/bcs'
import type { CoreClient, SuiClientTypes } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase58, fromBase64, fromHex, normalizeStructTag,
  toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep as readStep } from './profile-read-step'

/** Public, release-selected configuration. This is not a chain/code attestation. */
export interface WalletProfileDeployment {
  originalPackageId: string
  callablePackageId: string
  registryId: string
  chainIdentifier: string
}
export interface PublicProfileMetadataRef {
  blobObjectId: string
  blobId: string
  sha256: string
  byteLength: number
}
export interface WalletProfileSnapshot {
  id: string; registryId: string; owner: string; revision: string; handle: string | null
  objectVersion: string; objectDigest: string; createdAtMs: string; updatedAtMs: string
  metadata: PublicProfileMetadataRef
}
export interface ProfileRegistrySnapshot {
  id: string; profileCount: string; byOwnerId: string; byHandleId: string; byIndexId: string
}
export type WalletProfileReadClient = Pick<CoreClient,
  'getObject' | 'getChainIdentifier' | 'listOwnedObjects'>

const MAX_U64 = 18446744073709551615n
const RESERVED = new Set(['clawnews_bot', 'system', 'admin', 'moderator'])
const ID_TYPE = normalizeStructTag('0x2::object::ID')
const STRING_TYPE = normalizeStructTag('0x1::string::String')
const TableBcs = bcs.struct('ProfileTable', { id: bcs.Address, size: bcs.u64() })
export const PublicProfileMetadataRefBcs = bcs.struct('PublicMetadataV1', {
  blob_object_id: bcs.Address, blob_id: bcs.vector(bcs.u8()), sha256: bcs.vector(bcs.u8()), byte_length: bcs.u64(),
})
export const ProfileRegistryV1Bcs = bcs.struct('ProfileRegistryV1', {
  id: bcs.Address, version: bcs.u64(), profile_count: bcs.u64(),
  by_owner: TableBcs, by_handle: TableBcs, by_index: TableBcs,
})
export const WalletProfileV1Bcs = bcs.struct('WalletProfileV1', {
  id: bcs.Address, version: bcs.u64(), registry_id: bcs.Address, owner: bcs.Address,
  revision: bcs.u64(), handle: bcs.string(), metadata: PublicProfileMetadataRefBcs,
  created_at_ms: bcs.u64(), updated_at_ms: bcs.u64(),
})
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code)
}
function requireId(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'PROFILE_INVALID_ID')
}
function requireU64(value: unknown, positive = false): asserts value is string {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
    && BigInt(value) <= MAX_U64 && (!positive || value !== '0'), 'PROFILE_INVALID_U64')
}
function requireDigest(value: string) {
  check(typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
    && fromBase58(value).length === 32 && toBase58(fromBase58(value)) === value, 'PROFILE_INVALID_DIGEST')
}
const blobBytes = (blobId: string) => fromBase64(blobId.replaceAll('-', '+').replaceAll('_', '/') + '=')
const blobText = (bytes: Uint8Array) => toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

export function assertWalletProfileDeployment(value: WalletProfileDeployment): WalletProfileDeployment {
  const target = structuredClone(value)
  check(target && typeof target === 'object', 'PROFILE_DEPLOYMENT_REQUIRED')
  for (const key of ['originalPackageId', 'callablePackageId', 'registryId'] as const) requireId(target[key])
  check(typeof target.chainIdentifier === 'string' && /^[0-9a-f]{8}$/.test(target.chainIdentifier), 'PROFILE_INVALID_CHAIN')
  return target
}

/** Preserve existing profile form normalization, including clearing the handle. */
export function normalizeWalletProfileHandle(value: string | null): string {
  check(value === null || typeof value === 'string', 'PROFILE_INVALID_HANDLE')
  const handle = value?.trim().toLowerCase() ?? ''
  check(handle === '' || /^[a-z0-9_]{3,30}$/.test(handle), 'PROFILE_INVALID_HANDLE')
  check(!RESERVED.has(handle), 'PROFILE_RESERVED_HANDLE')
  return handle
}

export function assertPublicProfileMetadataRef(value: PublicProfileMetadataRef): PublicProfileMetadataRef {
  const ref = structuredClone(value)
  check(ref && typeof ref === 'object', 'PROFILE_METADATA_REQUIRED')
  requireId(ref.blobObjectId)
  check(typeof ref.blobId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(ref.blobId)
    && blobBytes(ref.blobId).length === 32 && blobText(blobBytes(ref.blobId)) === ref.blobId, 'PROFILE_INVALID_BLOB_ID')
  check(typeof ref.sha256 === 'string' && /^[0-9a-f]{64}$/.test(ref.sha256), 'PROFILE_INVALID_METADATA_HASH')
  check(Number.isSafeInteger(ref.byteLength) && ref.byteLength > 0 && ref.byteLength <= 65536, 'PROFILE_INVALID_METADATA_LENGTH')
  return ref
}

function metadataArgs(tx: Transaction, ref: PublicProfileMetadataRef) {
  return [tx.pure.id(ref.blobObjectId), tx.pure.vector('u8', [...blobBytes(ref.blobId)]),
    tx.pure.vector('u8', [...fromHex(ref.sha256)]), tx.pure.u64(ref.byteLength)]
}
export function buildCreateWalletProfileTx(params: {
  deployment: WalletProfileDeployment; owner: string; handle: string | null; metadata: PublicProfileMetadataRef
}): Transaction {
  const target = assertWalletProfileDeployment(params.deployment)
  requireId(params.owner)
  const handle = normalizeWalletProfileHandle(params.handle)
  const metadata = assertPublicProfileMetadataRef(params.metadata)
  const tx = new Transaction()
  tx.setSender(params.owner)
  tx.moveCall({ target: `${target.callablePackageId}::profile::create_profile`, arguments: [
    tx.object(target.registryId), tx.pure.string(handle), ...metadataArgs(tx, metadata), tx.object('0x6'),
  ] })
  return tx
}
export function buildUpdateWalletProfileTx(params: {
  deployment: WalletProfileDeployment; owner: string; profileId: string; expectedRevision: string
  handle: string | null; metadata: PublicProfileMetadataRef
}): Transaction {
  const target = assertWalletProfileDeployment(params.deployment)
  requireId(params.owner); requireId(params.profileId); requireU64(params.expectedRevision)
  check(BigInt(params.expectedRevision) < MAX_U64, 'PROFILE_REVISION_EXHAUSTED')
  const handle = normalizeWalletProfileHandle(params.handle)
  const metadata = assertPublicProfileMetadataRef(params.metadata)
  const tx = new Transaction()
  tx.setSender(params.owner)
  tx.moveCall({ target: `${target.callablePackageId}::profile::update_profile`, arguments: [
    tx.object(target.registryId), tx.object(params.profileId), tx.pure.u64(params.expectedRevision),
    tx.pure.string(handle), ...metadataArgs(tx, metadata), tx.object('0x6'),
  ] })
  return tx
}

type ReadObject = SuiClientTypes.Object<{ content: true }>
function assertObject(object: ReadObject, id: string, type: string) {
  check(object && object.objectId === id && object.type === type, 'PROFILE_OBJECT_IDENTITY_MISMATCH')
  requireU64(object.version, true); requireDigest(object.digest)
  check(object.content instanceof Uint8Array && object.content.length > 0
    && object.content.length <= 2048, 'PROFILE_OBJECT_CONTENT_INVALID')
}
function signalFor(signal?: AbortSignal) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
}
async function assertChain(client: WalletProfileReadClient, deployment: WalletProfileDeployment, signal: AbortSignal) {
  signal.throwIfAborted()
  const { chainIdentifier } = await readStep(signal, () => client.getChainIdentifier({ signal }))
  requireDigest(chainIdentifier)
  check(toHex(fromBase58(chainIdentifier).subarray(0, 4)) === deployment.chainIdentifier, 'PROFILE_WRONG_CHAIN')
  signal.throwIfAborted()
}
async function readRegistry(client: WalletProfileReadClient, target: WalletProfileDeployment, signal: AbortSignal) {
  const { object } = await readStep(signal, () => client.getObject({ objectId: target.registryId, include: { content: true }, signal }))
  assertObject(object, target.registryId, `${target.originalPackageId}::profile::ProfileRegistryV1`)
  check(object.owner?.$kind === 'Shared', 'PROFILE_REGISTRY_NOT_SHARED')
  requireU64(object.owner.Shared.initialSharedVersion, true)
  const value = ProfileRegistryV1Bcs.parse(object.content)
  check(toBase64(ProfileRegistryV1Bcs.serialize(value).toBytes()) === toBase64(object.content)
    && value.id === object.objectId && value.version === '1', 'PROFILE_REGISTRY_CONTENT_MISMATCH')
  const tables = [value.by_owner, value.by_handle, value.by_index]
  for (const table of tables) { requireId(table.id); requireU64(table.size) }
  check(new Set(tables.map(table => table.id)).size === 3
    && tables.every(table => table.id !== value.id)
    && value.by_owner.size === value.profile_count && value.by_index.size === value.profile_count
    && BigInt(value.by_handle.size) <= BigInt(value.profile_count), 'PROFILE_REGISTRY_INDEX_MISMATCH')
  return { id: value.id, profileCount: value.profile_count, byOwnerId: value.by_owner.id,
    byHandleId: value.by_handle.id, byIndexId: value.by_index.id } satisfies ProfileRegistrySnapshot
}

async function lookupId(client: WalletProfileReadClient, parentId: string, nameType: string, nameBcs: Uint8Array, signal: AbortSignal) {
  signal.throwIfAborted()
  const fieldId = deriveDynamicFieldID(parentId, nameType, nameBcs)
  const { object } = await readStep(signal, () => client.getObject({ objectId: fieldId, include: { content: true }, signal }))
  assertObject(object, fieldId, normalizeStructTag(`0x2::dynamic_field::Field<${nameType},${ID_TYPE}>`))
  // Core.getDynamicField currently substitutes the requested name bytes and
  // omits the raw owner. Verify the actual fixed-layout Field<key, ID> instead.
  check(object.owner.$kind === 'ObjectOwner' && object.owner.ObjectOwner === parentId
    && object.content.length === 64 + nameBcs.length
    && bcs.Address.parse(object.content.subarray(0, 32)) === fieldId
    && toBase64(object.content.subarray(32, 32 + nameBcs.length)) === toBase64(nameBcs),
  'PROFILE_INDEX_FIELD_MISMATCH')
  const id = bcs.Address.parse(object.content.subarray(32 + nameBcs.length)); requireId(id)
  return id
}

function parseProfile(object: ReadObject, target: WalletProfileDeployment, id: string): WalletProfileSnapshot {
  assertObject(object, id, `${target.originalPackageId}::profile::WalletProfileV1`)
  const value = WalletProfileV1Bcs.parse(object.content)
  check(toBase64(WalletProfileV1Bcs.serialize(value).toBytes()) === toBase64(object.content)
    && value.id === id && value.version === '1' && value.registry_id === target.registryId,
  'PROFILE_CONTENT_IDENTITY_MISMATCH')
  requireId(value.owner)
  check(object.owner?.$kind === 'AddressOwner' && object.owner.AddressOwner === value.owner, 'PROFILE_OWNER_MISMATCH')
  check(normalizeWalletProfileHandle(value.handle) === value.handle, 'PROFILE_NONCANONICAL_HANDLE')
  check(BigInt(value.updated_at_ms) >= BigInt(value.created_at_ms), 'PROFILE_INVALID_TIMESTAMPS')
  const metadata = assertPublicProfileMetadataRef({ blobObjectId: value.metadata.blob_object_id,
    blobId: blobText(new Uint8Array(value.metadata.blob_id)), sha256: toHex(new Uint8Array(value.metadata.sha256)),
    byteLength: Number(value.metadata.byte_length) })
  return { id, registryId: value.registry_id, owner: value.owner, revision: value.revision, handle: value.handle || null,
    objectVersion: object.version, objectDigest: object.digest,
    createdAtMs: value.created_at_ms, updatedAtMs: value.updated_at_ms, metadata }
}
async function profileAtRegistry(client: WalletProfileReadClient, target: WalletProfileDeployment,
  registry: ProfileRegistrySnapshot, id: string, signal: AbortSignal, prefetched?: ReadObject) {
  signal.throwIfAborted()
  const object = prefetched ?? (await readStep(signal, () => client.getObject({ objectId: id, include: { content: true }, signal }))).object
  const profile = parseProfile(object, target, id)
  check(await lookupId(client, registry.byOwnerId, 'address', bcs.Address.serialize(profile.owner).toBytes(), signal) === id,
    'PROFILE_OWNER_INDEX_MISMATCH')
  signal.throwIfAborted()
  return profile
}

export async function readWalletProfile(params: {
  client: WalletProfileReadClient; deployment: WalletProfileDeployment; profileId: string; signal?: AbortSignal
}): Promise<WalletProfileSnapshot> {
  const target = assertWalletProfileDeployment(params.deployment)
  const { client, profileId } = params; requireId(profileId)
  const signal = signalFor(params.signal)
  await assertChain(client, target, signal)
  const registry = await readRegistry(client, target, signal)
  return profileAtRegistry(client, target, registry, profileId, signal)
}

/** A complete owned-object result distinguishes no profile from transport failure.
 * Never turn an arbitrary RPC exception into a signed-in/new-account state. */
export async function readMyWalletProfile(params: {
  client: WalletProfileReadClient; deployment: WalletProfileDeployment; owner: string; signal?: AbortSignal
}): Promise<WalletProfileSnapshot | null> {
  const target = assertWalletProfileDeployment(params.deployment)
  const { client, owner } = params; requireId(owner)
  const signal = signalFor(params.signal)
  await assertChain(client, target, signal)
  const registry = await readRegistry(client, target, signal)
  const page = await readStep(signal, () => client.listOwnedObjects({ owner, type: `${target.originalPackageId}::profile::WalletProfileV1`,
    include: { content: true }, limit: 2, signal }))
  signal.throwIfAborted()
  check(!page.hasNextPage && page.objects.length <= 1, 'PROFILE_AMBIGUOUS_OWNED_RESULT')
  if (!page.objects.length) return null
  const profile = await profileAtRegistry(client, target, registry, page.objects[0].objectId, signal, page.objects[0])
  check(profile.owner === owner, 'PROFILE_WRONG_WALLET')
  return profile
}

export async function readWalletProfileByHandle(params: {
  client: WalletProfileReadClient; deployment: WalletProfileDeployment; handle: string; signal?: AbortSignal
}): Promise<WalletProfileSnapshot> {
  const target = assertWalletProfileDeployment(params.deployment)
  const { client } = params
  const handle = normalizeWalletProfileHandle(params.handle); check(handle, 'PROFILE_HANDLE_REQUIRED')
  const signal = signalFor(params.signal)
  await assertChain(client, target, signal)
  const registry = await readRegistry(client, target, signal)
  const id = await lookupId(client, registry.byHandleId, STRING_TYPE, bcs.string().serialize(handle).toBytes(), signal)
  const profile = await profileAtRegistry(client, target, registry, id, signal)
  check(profile.handle === handle, 'PROFILE_HANDLE_CHANGED_RETRY')
  return profile
}

/** Bounded, creation-order chain directory. No hidden full-chain scan or private
 * indexer; the caller gets an explicit next index and observed upper bound. */
export async function readWalletProfileDirectory(params: {
  client: WalletProfileReadClient; deployment: WalletProfileDeployment; startIndex?: string
  limit?: number; signal?: AbortSignal
}): Promise<{ profiles: WalletProfileSnapshot[]; nextIndex: string | null; observedCount: string }> {
  const target = assertWalletProfileDeployment(params.deployment)
  const { client, startIndex = '0', limit = 20 } = params
  requireU64(startIndex); check(Number.isInteger(limit) && limit > 0 && limit <= 50, 'PROFILE_INVALID_PAGE_LIMIT')
  const signal = signalFor(params.signal)
  await assertChain(client, target, signal)
  const registry = await readRegistry(client, target, signal)
  const start = BigInt(startIndex), total = BigInt(registry.profileCount)
  check(start <= total, 'PROFILE_PAGE_OUT_OF_RANGE')
  const end = start + BigInt(limit) < total ? start + BigInt(limit) : total
  const profiles: WalletProfileSnapshot[] = []
  for (let offset = start; offset < end; offset += 8n) {
    signal.throwIfAborted()
    const indices: bigint[] = []
    for (let index = offset; index < end && index < offset + 8n; index++) indices.push(index)
    profiles.push(...await Promise.all(indices.map(async index => {
      const id = await lookupId(client, registry.byIndexId, 'u64', bcs.u64().serialize(index).toBytes(), signal)
      return profileAtRegistry(client, target, registry, id, signal)
    })))
  }
  check(new Set(profiles.map(profile => profile.id)).size === profiles.length, 'PROFILE_DUPLICATE_DIRECTORY_ENTRY')
  signal.throwIfAborted()
  return { profiles, nextIndex: end < total ? String(end) : null, observedCount: registry.profileCount }
}
