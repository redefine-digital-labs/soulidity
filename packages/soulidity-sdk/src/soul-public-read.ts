import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep } from './profile-read-step'
import { deriveKioskItemFieldId, assertKioskItemField, KIOSK_ITEM_FIELD_TYPE, KIOSK_ITEM_FIELD_BYTES } from './kiosk-item-custody'
import { decodeSoulPublicPreview, SOUL_PUBLIC_PREVIEW_KEY, type SoulPublicPreview } from './soul-public-preview'

export interface SoulPublicDeployment { originalPackageId: string; chainIdentifier: string }
export interface SoulPublicReadClient {
  core: Pick<SuiGrpcClient['core'], 'getChainIdentifier'>
  ledgerService: Pick<SuiGrpcClient['ledgerService'], 'getObject'>
}
export interface SoulPublicSnapshot {
  soulId: string; stateId: string; creator: string; currentOwner: string; kioskId: string
  name: string; description: string; imageUrl: string; provenanceKind: 0 | 1 | 2 | 3; originRef: string | null
  creatorRoyaltyBps: number; ownershipEpoch: string; collectionId: string | null
  listedIndividually: boolean; contentId: string; createdAtMs: string
  publicPreview: Readonly<SoulPublicPreview>
  stateVersion: string; stateDigest: string
}
const A = bcs.Address, U = bcs.u64(), S = bcs.string(), B = bcs.bool()
export const SoulStatePointerKeyV1Bcs = bcs.struct('SoulStatePointerKeyV1', { version: bcs.u8() })
export const SoulStatePointerFieldV1Bcs = bcs.struct('SoulStatePointerFieldV1', {
  id: A, name: SoulStatePointerKeyV1Bcs, value: A,
})
const Table = bcs.struct('Table', { id: A, size: U })
export const SoulPublicBcs = bcs.struct('Soul', { id: A, version: U, name: S, description: S,
  image_url: S, provenance_kind: bcs.u8(), origin_ref: bcs.option(S), creator: A })
export const SoulStatePublicBcs = bcs.struct('SoulState', { id: A, version: U, soul_id: A, creator: A,
  creator_royalty_bps: bcs.u16(), current_owner: A, current_kiosk_id: A, ownership_epoch: U,
  grant_capacity: U, active_grants: Table, active_grant_ids: Table, active_grant_count: U,
  content_id: bcs.option(A), config_ext: Table, collection_id: bcs.option(A), access_list_id: bcs.option(A), is_listed: B })
export const SoulContentPublicBcs = bcs.struct('SoulContent', { id: A, version: U, soul_id: A,
  items: Table, count_by_kind: Table, active: Table })
export const SoulContentKeyPublicBcs = bcs.struct('ContentKey', { kind: bcs.u32(), name: S })
export const SoulContentSlotPublicBcs = bcs.struct('ContentSlot', { version: U, kind: bcs.u32(), blob_object_id: A,
  is_public: B, deleted: B, purged: B, download_policy: bcs.u8(), grant_scope_mask: U,
  read_mode_mask: U, op_mask: U, seal_encrypted: B, created_at_ms: U })
const ConfigField = bcs.struct('ConfigField', { id: A, name: S, value: bcs.vector(bcs.u8()) })
const SlotsField = bcs.struct('SlotsField', { id: A, name: SoulContentKeyPublicBcs, value: bcs.vector(SoulContentSlotPublicBcs) })
type RawObject = NonNullable<Awaited<ReturnType<SoulPublicReadClient['ledgerService']['getObject']>>['response']['object']>
const MAX_U64 = 18446744073709551615n
// Reader resource budget, not a Move metadata limit. In particular origin_ref
// is free-form and has no per-field cap in the current mint contract/builders.
export const SOUL_PUBLIC_MAX_SOUL_BYTES = 256 * 1024
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(code) }
function id(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'SOUL_PUBLIC_INVALID_ID')
}
export function assertSoulPublicDeployment(input: SoulPublicDeployment): SoulPublicDeployment {
  const value = structuredClone(input)
  check(value && typeof value === 'object' && Object.keys(value).length === 2
    && Object.hasOwn(value, 'originalPackageId') && Object.hasOwn(value, 'chainIdentifier'), 'SOUL_PUBLIC_DEPLOYMENT_INVALID')
  id(value.originalPackageId)
  check(typeof value.chainIdentifier === 'string' && /^[0-9a-f]{8}$/.test(value.chainIdentifier), 'SOUL_PUBLIC_CHAIN_INVALID')
  return Object.freeze(value)
}
function decode<Schema extends { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }>(schema: Schema, bytes: Uint8Array): ReturnType<Schema['parse']> {
  const value = schema.parse(bytes)
  check(toBase64(schema.serialize(value).toBytes()) === toBase64(bytes), 'SOUL_PUBLIC_NONCANONICAL_BCS')
  return value
}

/** Exact current public object read set. No legacy JSON projection, event-log
 * directory, decrypted content, or guessed identity. Every accepted mutable
 * object is reread before returning the snapshot. */
export async function readSoulPublicSnapshot(params: {
  client: SoulPublicReadClient; deployment: SoulPublicDeployment; stateId: string; signal?: AbortSignal
}): Promise<SoulPublicSnapshot> {
  return readSoulPublicReadSet(params, { kind: 'state', id: params.stateId })
}

/** Fresh Soul deep links resolve only the immutable, package-defined pointer.
 * The pointer, matching State and Soul custody belong to the same stable read
 * set as the metadata. Absence is an error, never a scan or legacy fallback. */
export async function readSoulPublicSnapshotBySoulId(params: {
  client: SoulPublicReadClient; deployment: SoulPublicDeployment; soulId: string; signal?: AbortSignal
}): Promise<SoulPublicSnapshot> {
  return readSoulPublicReadSet(params, { kind: 'soul', id: params.soulId })
}

async function readSoulPublicReadSet(params: {
  client: SoulPublicReadClient; deployment: SoulPublicDeployment; signal?: AbortSignal
}, target: { kind: 'soul' | 'state'; id: string }): Promise<SoulPublicSnapshot> {
  const deployment = assertSoulPublicDeployment(params.deployment), client = params.client
  id(target.id)
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000)
  const { chainIdentifier } = await profileReadStep(signal, () => client.core.getChainIdentifier())
  const genesis = fromBase58(chainIdentifier)
  check(genesis.length === 32 && toBase58(genesis) === chainIdentifier
    && toHex(genesis.subarray(0, 4)) === deployment.chainIdentifier, 'SOUL_PUBLIC_WRONG_CHAIN')
  const pkg = deployment.originalPackageId
  const seen = new Map<string, { raw: RawObject; type: string; kind: number; owner?: string; maximum: number }>()
  async function read(objectId: string, type: string, kind: number, owner?: string, maximum = 8192) {
    id(objectId)
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId,
      readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } }))
    const raw = response.object
    check(raw?.objectId === objectId && typeof raw.version === 'bigint' && raw.version > 0n && raw.version <= MAX_U64
      && raw.objectType === normalizeStructTag(type), 'SOUL_PUBLIC_OBJECT_IDENTITY_MISMATCH')
    check(typeof raw.digest === 'string' && fromBase58(raw.digest).length === 32
      && toBase58(fromBase58(raw.digest)) === raw.digest, 'SOUL_PUBLIC_DIGEST_INVALID')
    check(raw.owner?.kind === kind && (!owner || raw.owner.address === owner)
      && (kind !== 3 || typeof raw.owner.version === 'bigint' && raw.owner.version > 0n && raw.owner.version <= raw.version),
    'SOUL_PUBLIC_CUSTODY_MISMATCH')
    check(raw.contents?.value instanceof Uint8Array && raw.contents.value.length > 0, 'SOUL_PUBLIC_CONTENT_INVALID')
    check(raw.contents.value.length <= maximum, 'SOUL_PUBLIC_READ_BUDGET_EXCEEDED')
    const previous = seen.get(objectId)
    if (previous) check(previous.type === type && previous.kind === kind && previous.owner === owner
      && previous.raw.version === raw.version && previous.raw.digest === raw.digest
      && previous.raw.owner?.version === raw.owner?.version
      && toBase64(previous.raw.contents!.value!) === toBase64(raw.contents.value), 'SOUL_PUBLIC_CHANGED_RETRY')
    else seen.set(objectId, { raw: structuredClone(raw), type, kind, owner, maximum })
    return raw.contents.value
  }
  let stateId = target.id
  if (target.kind === 'soul') {
    const keyType = `${pkg}::soul::SoulStatePointerKeyV1`
    const pointerId = deriveDynamicFieldID(target.id, keyType, SoulStatePointerKeyV1Bcs.serialize({ version: 1 }).toBytes())
    const pointer = decode(SoulStatePointerFieldV1Bcs, await read(pointerId,
      `0x2::dynamic_field::Field<${keyType},0x2::object::ID>`, 2, target.id, 65))
    check(pointer.id === pointerId && pointer.name.version === 1, 'SOUL_PUBLIC_STATE_POINTER_MISMATCH')
    id(pointer.value)
    check(pointer.value !== target.id && pointer.value !== pointerId, 'SOUL_PUBLIC_OBJECT_ALIAS')
    stateId = pointer.value
  }
  const state = decode(SoulStatePublicBcs, await read(stateId, `${pkg}::soul::SoulState`, 3))
  check(state.id === stateId && state.version === '1', 'SOUL_PUBLIC_STATE_MISMATCH')
  if (target.kind === 'soul') check(state.soul_id === target.id, 'SOUL_PUBLIC_STATE_POINTER_MISMATCH')
  for (const value of [state.soul_id, state.creator, state.current_owner, state.current_kiosk_id, state.content_id,
    state.config_ext.id, state.active_grants.id, state.active_grant_ids.id]) id(value)
  if (state.collection_id !== null) id(state.collection_id)
  if (state.access_list_id !== null) id(state.access_list_id)
  check(state.creator_royalty_bps <= 10000 && BigInt(state.active_grant_count) <= BigInt(state.grant_capacity)
    && BigInt(state.active_grant_count) <= BigInt(state.active_grants.size) && state.active_grants.size === state.active_grant_ids.size,
  'SOUL_PUBLIC_STATE_COUNTER_MISMATCH')
  check(new Set([state.id, state.soul_id, state.content_id, state.config_ext.id, state.active_grants.id,
    state.active_grant_ids.id, state.current_kiosk_id]).size === 7, 'SOUL_PUBLIC_OBJECT_ALIAS')
  const itemFieldId = deriveKioskItemFieldId(state.current_kiosk_id, state.soul_id)
  assertKioskItemField(await read(itemFieldId, KIOSK_ITEM_FIELD_TYPE, 2, state.current_kiosk_id, KIOSK_ITEM_FIELD_BYTES),
    state.current_kiosk_id, state.soul_id)
  const soul = decode(SoulPublicBcs, await read(state.soul_id, `${pkg}::soul::Soul`, 2, itemFieldId, SOUL_PUBLIC_MAX_SOUL_BYTES))
  check(soul.id === state.soul_id && soul.version === '1' && soul.creator === state.creator
    && [0, 1, 2, 3].includes(soul.provenance_kind), 'SOUL_PUBLIC_SOUL_MISMATCH')
  // Canonical BCS roundtrip also rejects invalid UTF-8. Writer UX limits are not
  // extra protocol rules for otherwise valid raw Move strings.

  const configType = '0x1::string::String'
  const configId = deriveDynamicFieldID(state.config_ext.id, configType, S.serialize(SOUL_PUBLIC_PREVIEW_KEY).toBytes())
  const config = decode(ConfigField, await read(configId, `0x2::dynamic_field::Field<${configType},vector<u8>>`, 2, state.config_ext.id, 66000))
  check(config.id === configId && config.name === SOUL_PUBLIC_PREVIEW_KEY && BigInt(state.config_ext.size) >= 1n,
    'SOUL_PUBLIC_PREVIEW_FIELD_MISMATCH')
  // A missing/malformed row never becomes guessed empty arrays.
  const publicPreview = decodeSoulPublicPreview(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(config.value)))

  const contentId = state.content_id!
  const content = decode(SoulContentPublicBcs, await read(contentId, `${pkg}::content::SoulContent`, 3))
  check(content.id === contentId && content.version === '1' && content.soul_id === soul.id, 'SOUL_PUBLIC_CONTENT_ROOT_MISMATCH')
  for (const table of [content.items, content.count_by_kind, content.active]) id(table.id)
  check(new Set([content.id, content.items.id, content.count_by_kind.id, content.active.id]).size === 4
    && BigInt(content.items.size) >= 2n && BigInt(content.count_by_kind.size) >= 2n
    && BigInt(content.count_by_kind.size) <= BigInt(content.items.size)
    && BigInt(content.active.size) <= BigInt(content.count_by_kind.size), 'SOUL_PUBLIC_CONTENT_TABLE_MISMATCH')
  const key = { kind: 0, name: 'soul' }, keyType = `${pkg}::content::ContentKey`
  const fieldId = deriveDynamicFieldID(content.items.id, keyType, SoulContentKeyPublicBcs.serialize(key).toBytes())
  const slots = decode(SlotsField, await read(fieldId, `0x2::dynamic_field::Field<${keyType},vector<${pkg}::content::ContentSlot>>`, 2, content.items.id, 512))
  check(slots.id === fieldId && slots.name.kind === 0 && slots.name.name === 'soul' && slots.value.length === 1,
    'SOUL_PUBLIC_MINT_TIME_FIELD_MISMATCH')
  const initial = slots.value[0]
  id(initial.blob_object_id)
  check(initial.version === '1' && initial.kind === 0 && !initial.is_public && !initial.deleted && !initial.purged
    && initial.download_policy === 0 && initial.read_mode_mask === '3' && initial.op_mask === '0' && initial.seal_encrypted,
  'SOUL_PUBLIC_INITIAL_CONTENT_MISMATCH')
  // Read only the slot's public Clock timestamp. Never download/decrypt soul.md.
  for (const [objectId, entry] of seen) await read(objectId, entry.type, entry.kind, entry.owner, entry.maximum)
  signal.throwIfAborted()
  const stateRaw = seen.get(stateId)!.raw
  return { soulId: soul.id, stateId, creator: state.creator, currentOwner: state.current_owner, kioskId: state.current_kiosk_id,
    name: soul.name, description: soul.description, imageUrl: soul.image_url, provenanceKind: soul.provenance_kind as 0 | 1 | 2 | 3,
    originRef: soul.origin_ref, creatorRoyaltyBps: state.creator_royalty_bps, ownershipEpoch: state.ownership_epoch,
    collectionId: state.collection_id, listedIndividually: state.is_listed, contentId, createdAtMs: initial.created_at_ms,
    publicPreview, stateVersion: String(stateRaw.version), stateDigest: stateRaw.digest! }
}
