import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep } from './profile-read-step'
import { deriveKioskItemFieldId, assertKioskItemField, KIOSK_ITEM_FIELD_TYPE } from './kiosk-item-custody'
import { SoulStatePublicBcs, SoulPublicBcs, SoulContentPublicBcs, SoulContentKeyPublicBcs, SoulContentSlotPublicBcs } from './soul-public-read'

const A = bcs.Address, U = bcs.u64(), S = bcs.string(), N = bcs.u32(), B = bcs.bool(), V = bcs.vector(bcs.u8())
const Table = bcs.struct('Table', { id: A, size: U })
const Active = bcs.struct('ActiveBinding', { version: U, kind: N, name: S, version_index: U, download_policy: bcs.u8() })
const GrantSlot = bcs.struct('ActiveGrantSlot', { version: U, grant_id: A, grantee: A, scope_mask: U, expires_at_ms: bcs.option(U), ownership_epoch_snapshot: U })
const Grant = bcs.struct('SoulGrant', { id: A, version: U, soul_id: A, grantee: A, issued_by: A,
  ownership_epoch_snapshot: U, scope_mask: U, expires_at_ms: bcs.option(U) })
const PaidConfig = bcs.struct('KindPaidConfig', { version: U, price_atomic: U, scope_mask: U, duration_ms: bcs.option(U), ownership_epoch_snapshot: U })
const PaidEntry = bcs.struct('KindPaidEntry', { version: U, scope_mask: U, expires_at_ms: bcs.option(U), ownership_epoch_snapshot: U })
const Paid = bcs.struct('SoulPaidAccessList', { id: A, version: U, soul_id: A, creator: A, kind_configs: Table, entries: Table })
const Descriptor = bcs.struct('KindDescriptor', { version: U, kind: N, name: S, op_mask: U, read_mode_mask: U,
  has_active_binding: B, requires_download_policy: B, default_grant_scope_mask: U, deprecated: B })
const Registry = bcs.struct('KindRegistry', { id: A, version: U, next_kind: N, kinds: Table, name_to_kind: Table })
const Clock = bcs.struct('Clock', { id: A, timestamp_ms: U })
export const SoulDetailStateBcs = Object.freeze({ Table, Active, GrantSlot, Grant, PaidConfig, PaidEntry, Paid, Descriptor, Registry, Clock })
export interface SoulDetailStateClient {
  core: Pick<SuiGrpcClient['core'], 'getChainIdentifier'>
  ledgerService: Pick<SuiGrpcClient['ledgerService'], 'getObject' | 'batchGetObjects'>
  stateService: Pick<SuiGrpcClient['stateService'], 'listDynamicFields'>
}
export interface SoulDetailStateRequest {
  client: SoulDetailStateClient
  deployment: { originalPackageId: string; chainIdentifier: string; kindRegistryId: string }
  stateId: string
  expectedState: { version: string; digest: string }
  /** Display scope only, not authentication. Owner sees all paid buyers; other viewers only their own rows. */
  viewerAddresses: readonly string[]
  /** Also read current descriptors for kinds with no content/paid rows yet. */
  kindIds?: readonly number[]
  signal?: AbortSignal
}
const MAX = 18446744073709551615n, CLOCK = `0x${'0'.repeat(63)}6`
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`SOUL_DETAIL_${code}`) }
function id(value: unknown): asserts value is string { check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'INVALID_ID') }
function address(value: unknown): asserts value is string { check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value), 'INVALID_ADDRESS') }
function exact(value: unknown, keys: string[]) { check(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join() === keys.sort().join(), 'INVALID_FIELDS') }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
function decode<T extends Codec>(schema: T, bytes: Uint8Array): ReturnType<T['parse']> {
  const value = schema.parse(bytes); check(toBase64(schema.serialize(value).toBytes()) === toBase64(bytes), 'NONCANONICAL_BCS'); return value
}
function mask(value: string, nonzero = true) { const n = BigInt(value); check(n <= 15n && (!nonzero || n > 0n), 'MASK_INVALID'); return n }
function typeTag(value: string) { return TypeTagSerializer.tagToString(TypeTagSerializer.parseFromStr(value, true)) }

/** Complete, bounded live table observation. Lists only discover candidate DF
 * names; every accepted row is fetched as canonical raw BCS, derived-ID checked,
 * and reread. No SQL dates, sidecars, plaintext, or transaction authorization are
 * synthesized. Capacity exhaustion is an explicit failure, never a partial array. */
export async function readSoulDetailState(params: SoulDetailStateRequest) {
  const { deployment: d, stateId, expectedState, viewerAddresses, kindIds } = structuredClone({ deployment: params.deployment,
    stateId: params.stateId, expectedState: params.expectedState, viewerAddresses: params.viewerAddresses,
    kindIds: params.kindIds === undefined ? [] : params.kindIds })
  exact(d, ['originalPackageId', 'chainIdentifier', 'kindRegistryId']); id(d.originalPackageId); id(d.kindRegistryId); id(stateId)
  check(typeof d.chainIdentifier === 'string' && /^[0-9a-f]{8}$/.test(d.chainIdentifier), 'INVALID_CHAIN')
  exact(expectedState, ['version', 'digest'])
  check(typeof expectedState.version === 'string' && /^[1-9][0-9]*$/.test(expectedState.version) && BigInt(expectedState.version) <= MAX
    && fromBase58(expectedState.digest).length === 32 && toBase58(fromBase58(expectedState.digest)) === expectedState.digest, 'INVALID_EXPECTED_STATE')
  check(Array.isArray(viewerAddresses) && viewerAddresses.length <= 16 && new Set(viewerAddresses).size === viewerAddresses.length, 'INVALID_VIEWERS')
  viewerAddresses.forEach(id)
  check(Array.isArray(kindIds) && kindIds.length <= 256 && new Set(kindIds).size === kindIds.length
    && Array.from(kindIds).every(kind => Number.isInteger(kind) && kind >= 0 && kind <= 0xffff_ffff), 'INVALID_REQUESTED_KINDS')
  const client = params.client, pkg = d.originalPackageId
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(40000)]) : AbortSignal.timeout(40000)
  const chain = (await profileReadStep(signal, () => client.core.getChainIdentifier())).chainIdentifier, genesis = fromBase58(chain)
  check(genesis.length === 32 && toBase58(genesis) === chain && toHex(genesis.subarray(0, 4)) === d.chainIdentifier, 'WRONG_CHAIN')
  type Raw = NonNullable<Awaited<ReturnType<SoulDetailStateClient['ledgerService']['getObject']>>['response']['object']>
  const reads = new Map<string, { type: string; kind?: number; owner?: string; raw: Raw | null }>()
  let byteCount = 0, fieldCount = 0, slotCount = 0
  async function read(objectId: string, type: string, kind?: number, owner?: string, optional = false, track = true): Promise<Uint8Array | null> {
    id(objectId)
    const { response } = await profileReadStep(signal, () => client.ledgerService.batchGetObjects({ requests: [{ objectId }],
      readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } }))
    check(response.objects.length === 1, 'INCOMPLETE_RESPONSE')
    const result = response.objects[0].result
    check(result.oneofKind === 'object' || optional && result.oneofKind === 'error' && result.error.code === 5, 'OBJECT_UNAVAILABLE')
    const raw = result.oneofKind === 'object' ? structuredClone(result.object) : null
    if (raw) {
      check(raw.objectId === objectId && raw.objectType === normalizeStructTag(type) && typeof raw.version === 'bigint'
        && raw.version > 0n && raw.version <= MAX, 'OBJECT_MISMATCH')
      check(typeof raw.digest === 'string' && fromBase58(raw.digest).length === 32 && toBase58(fromBase58(raw.digest)) === raw.digest, 'DIGEST_INVALID')
      check(raw.owner && typeof raw.owner.kind === 'number' && [1, 2, 3, 4].includes(raw.owner.kind) && (kind === undefined || raw.owner.kind === kind)
        && (owner === undefined || raw.owner.address === owner), 'CUSTODY_MISMATCH')
      if (raw.owner.kind === 1) address(raw.owner.address)
      if (raw.owner.kind === 2) id(raw.owner.address)
      if (raw.owner.kind === 3) check(typeof raw.owner.version === 'bigint' && raw.owner.version > 0n && raw.owner.version <= raw.version, 'SHARED_BIRTH_INVALID')
      check(raw.contents?.value instanceof Uint8Array && raw.contents.value.length > 0 && raw.contents.value.length <= 1024 * 1024, 'BCS_BUDGET')
      byteCount += raw.contents.value.length; check(byteCount <= 16 * 1024 * 1024, 'READ_BUDGET')
    }
    const previous = reads.get(objectId)
    if (previous) check(previous.type === type && previous.kind === kind && previous.owner === owner &&
      (previous.raw === null ? raw === null : raw !== null && previous.raw.version === raw.version && previous.raw.digest === raw.digest
        && previous.raw.owner?.kind === raw.owner?.kind && previous.raw.owner?.address === raw.owner?.address && previous.raw.owner?.version === raw.owner?.version
        && toBase64(previous.raw.contents!.value!) === toBase64(raw.contents!.value!)), 'CHANGED_RETRY')
    else if (track) reads.set(objectId, { type, kind, owner, raw })
    return raw ? raw.contents!.value! : null
  }
  async function field<K extends Codec, T extends Codec>(parent: string, keyType: string, keyCodec: K, key: ReturnType<K['parse']>, valueType: string, valueCodec: T, optional = false) {
    const keyBytes = keyCodec.serialize(key).toBytes(), fieldId = deriveDynamicFieldID(parent, keyType, keyBytes)
    const bytes = await read(fieldId, `0x2::dynamic_field::Field<${keyType},${valueType}>`, 2, parent, optional)
    if (bytes === null) return null
    const row = decode(bcs.struct('Field', { id: A, name: keyCodec as any, value: valueCodec as any }), bytes)
    check(row.id === fieldId && toBase64(keyCodec.serialize(row.name).toBytes()) === toBase64(keyBytes), 'FIELD_KEY_MISMATCH')
    return { fieldId, key: row.name as ReturnType<K['parse']>, value: row.value as ReturnType<T['parse']> }
  }
  async function table<K extends Codec, T extends Codec>(root: { id: string; size: string }, keyType: string, keyCodec: K, valueType: string, valueCodec: T) {
    id(root.id); check(BigInt(root.size) <= 2000n, 'TABLE_BUDGET')
    const result: NonNullable<Awaited<ReturnType<typeof field<K, T>>>>[] = [], seen = new Set<string>(), tokens = new Set<string>()
    let token: Uint8Array | undefined
    for (let page = 0; ; page++) {
      check(page < 40, 'PAGE_BUDGET')
      const { response } = await profileReadStep(signal, () => client.stateService.listDynamicFields({ parent: root.id,
        pageSize: 50, pageToken: token, readMask: { paths: ['field_id', 'name', 'value_type', 'kind'] } }))
      check(Array.isArray(response.dynamicFields) && response.dynamicFields.length <= 50, 'PAGE_INVALID')
      for (const candidate of response.dynamicFields) {
        check(++fieldCount <= 2000, 'FIELD_BUDGET')
        check(candidate.kind === 1 && typeof candidate.name?.name === 'string' && typeTag(candidate.name.name) === typeTag(keyType)
          && typeof candidate.valueType === 'string' && typeTag(candidate.valueType) === typeTag(valueType) && candidate.name.value instanceof Uint8Array
          && candidate.name.value.length <= 8192, 'DISCOVERY_ROW_INVALID')
        const key = decode(keyCodec, candidate.name.value), expected = deriveDynamicFieldID(root.id, keyType, candidate.name.value)
        check(candidate.fieldId === expected && !seen.has(expected), 'DUPLICATE_OR_WRONG_FIELD'); seen.add(expected)
        result.push((await field(root.id, keyType, keyCodec, key, valueType, valueCodec))!)
      }
      const next = response.nextPageToken
      check(next === undefined || next instanceof Uint8Array && next.length <= 4096, 'CURSOR_INVALID')
      if (next === undefined || next.length === 0) break
      const encoded = toBase64(next); check(!tokens.has(encoded), 'CURSOR_NOT_ADVANCING'); tokens.add(encoded); token = Uint8Array.from(next)
    }
    check(BigInt(result.length) === BigInt(root.size), 'TABLE_COUNT_MISMATCH')
    return result
  }
  const state = decode(SoulStatePublicBcs, (await read(stateId, `${pkg}::soul::SoulState`, 3))!)
  check(state.id === stateId && state.version === '1', 'STATE_MISMATCH')
  const stateRaw = reads.get(stateId)!.raw!
  check(String(stateRaw.version) === expectedState.version && stateRaw.digest === expectedState.digest, 'STALE_METADATA')
  for (const value of [state.soul_id, state.creator, state.current_owner, state.current_kiosk_id, state.content_id, state.access_list_id]) id(value)
  const itemFieldId = deriveKioskItemFieldId(state.current_kiosk_id, state.soul_id)
  assertKioskItemField((await read(itemFieldId, KIOSK_ITEM_FIELD_TYPE, 2, state.current_kiosk_id))!, state.current_kiosk_id, state.soul_id)
  const soul = decode(SoulPublicBcs, (await read(state.soul_id, `${pkg}::soul::Soul`, 2, itemFieldId))!)
  check(soul.id === state.soul_id && soul.version === '1' && soul.creator === state.creator, 'SOUL_MISMATCH')
  const content = decode(SoulContentPublicBcs, (await read(state.content_id!, `${pkg}::content::SoulContent`, 3))!)
  check(content.id === state.content_id && content.version === '1' && content.soul_id === state.soul_id, 'CONTENT_MISMATCH')
  const registry = decode(Registry, (await read(d.kindRegistryId, `${pkg}::kind_registry::KindRegistry`, 3))!)
  check(registry.id === d.kindRegistryId && registry.version === '1' && registry.next_kind >= 16, 'REGISTRY_MISMATCH')
  const tableIds = [state.config_ext, state.active_grants, state.active_grant_ids, content.items, content.count_by_kind,
    content.active, registry.kinds, registry.name_to_kind].map(t => { id(t.id); return t.id })
  const uniqueIds = [state.id, soul.id, content.id, registry.id, state.access_list_id, ...tableIds]
  check(new Set(uniqueIds).size === uniqueIds.length && registry.kinds.size === registry.name_to_kind.size, 'TABLE_ALIAS_OR_COUNT')
  const descriptors = new Map<number, ReturnType<typeof Descriptor.parse>>()
  async function descriptor(kind: number) {
    const cached = descriptors.get(kind); if (cached) return cached
    const row = await field(registry.kinds.id, 'u32', N, kind, `${pkg}::kind_registry::KindDescriptor`, Descriptor)
    const v = row!.value
    check(v.version === '1' && v.kind === kind && v.name.length > 0, 'KIND_MISMATCH')
    const op = mask(v.op_mask, false), rm = mask(v.read_mode_mask), scope = BigInt(v.default_grant_scope_mask)
    check((rm & 1n) !== 0n && v.has_active_binding === ((op & 8n) !== 0n) && v.requires_download_policy === ((rm & 8n) !== 0n)
      && ((rm & 6n) === 0n ? scope === 0n : [1n, 2n, 4n, 8n].includes(scope)), 'KIND_MASK_INVALID')
    const reverse = await field(registry.name_to_kind.id, '0x1::string::String', S, v.name, 'u32', N)
    check(reverse!.value === kind, 'KIND_NAME_MISMATCH'); descriptors.set(kind, v); return v
  }
  const configRows = await table(state.config_ext, '0x1::string::String', S, 'vector<u8>', V)
  const config = configRows.map(row => { check(row.key.length > 0, 'CONFIG_KEY_INVALID'); return { key: row.key, valueBytes: [...row.value],
    // Arbitrary config is bytes on chain. Invalid UTF-8 is not silently repaired.
    valueUtf8: (() => { try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(row.value)) } catch { return null } })() } })
  const contentRows = await table(content.items, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs, `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs))
  const versions: Array<{ kind: number; kindName: string; name: string; versionIndex: string; slot: ReturnType<typeof SoulContentSlotPublicBcs.parse> }> = []
  const counts = new Map<number, bigint>()
  for (const row of contentRows) {
    const desc = await descriptor(row.key.kind)
    check(/^[a-z0-9_-]{1,32}$/.test(row.key.name) && row.value.length > 0
      && (row.key.kind !== 0 || row.key.name === 'soul') && (row.key.kind !== 1 || row.key.name === 'default'), 'CONTENT_KEY_INVALID')
    // count_by_kind counts distinct ContentKey names, not version slots.
    counts.set(row.key.kind, (counts.get(row.key.kind) ?? 0n) + 1n)
    for (let i = 0; i < row.value.length; i++) {
      check(++slotCount <= 10000, 'SLOT_BUDGET')
      const slot = row.value[i], rm = mask(slot.read_mode_mask), op = mask(slot.op_mask, false)
      check(slot.version === '1' && slot.kind === row.key.kind && (rm & 1n) !== 0n && (rm & BigInt(desc.read_mode_mask)) === rm
        && op === BigInt(desc.op_mask) && slot.grant_scope_mask === desc.default_grant_scope_mask
        && slot.is_public === ((rm & 8n) !== 0n) && slot.seal_encrypted && [0, 1, 2].includes(slot.download_policy)
        && (!(slot.is_public || !desc.requires_download_policy) || slot.download_policy === 0)
        && (!slot.purged || slot.deleted), 'SLOT_MISMATCH')
      id(slot.blob_object_id)
      versions.push({ kind: row.key.kind, kindName: desc.name, name: row.key.name, versionIndex: String(i), slot })
    }
  }
  const countRows = await table(content.count_by_kind, 'u32', N, 'u64', U)
  check(countRows.length === counts.size && countRows.every(row => counts.get(row.key) === BigInt(row.value)), 'CONTENT_COUNT_MISMATCH')
  const activeRows = await table(content.active, 'u32', N, `${pkg}::content::ActiveBinding`, Active)
  for (const row of activeRows) {
    const v = row.value, desc = await descriptor(row.key), target = versions.find(x => x.kind === row.key && x.name === v.name && x.versionIndex === v.version_index)
    check(v.version === '1' && v.kind === row.key && desc.has_active_binding && target && !target.slot.deleted && !target.slot.purged
      && (BigInt(target.slot.op_mask) & 8n) !== 0n && target.slot.download_policy === v.download_policy, 'ACTIVE_BINDING_MISMATCH')
  }
  const grantRows = await table(state.active_grants, 'address', A, `${pkg}::soul::ActiveGrantSlot`, GrantSlot)
  const reverseGrants = await table(state.active_grant_ids, '0x2::object::ID', A, 'address', A)
  check(grantRows.length === reverseGrants.length, 'GRANT_INDEX_MISMATCH')
  const grants = []
  for (const row of grantRows) {
    const slot = row.value; id(slot.grant_id); id(slot.grantee); mask(slot.scope_mask)
    check(slot.version === '1' && slot.grantee === row.key && BigInt(slot.ownership_epoch_snapshot) <= BigInt(state.ownership_epoch)
      && reverseGrants.some(r => r.key === slot.grant_id && r.value === row.key), 'GRANT_INDEX_MISMATCH')
    const currentEpoch = slot.ownership_epoch_snapshot === state.ownership_epoch
    let grant: ReturnType<typeof Grant.parse> | null = null
    if (currentEpoch) {
      // SoulGrant is transferable/wrappable; its holder is NOT necessarily its
      // fixed grantee. Authorization remains the State slot, never object owner.
      grant = decode(Grant, (await read(slot.grant_id, `${pkg}::grant::SoulGrant`))!)
      check(grant.id === slot.grant_id && grant.version === '1' && grant.soul_id === state.soul_id && grant.grantee === slot.grantee
        && grant.issued_by === state.current_owner && grant.grantee !== grant.issued_by && grant.ownership_epoch_snapshot === slot.ownership_epoch_snapshot
        && grant.scope_mask === slot.scope_mask && grant.expires_at_ms === slot.expires_at_ms, 'GRANT_MISMATCH')
    }
    grants.push({ slot, currentEpoch, grant })
  }
  check(BigInt(grants.filter(g => g.currentEpoch).length) === BigInt(state.active_grant_count)
    && BigInt(state.active_grant_count) <= BigInt(state.grant_capacity), 'GRANT_COUNT_MISMATCH')
  const paid = decode(Paid, (await read(state.access_list_id!, `${pkg}::paid_access::SoulPaidAccessList`, 3))!)
  check(paid.id === state.access_list_id && paid.version === '1' && paid.soul_id === state.soul_id && paid.creator === state.creator, 'PAID_ROOT_MISMATCH')
  id(paid.kind_configs.id); id(paid.entries.id)
  check(new Set([...uniqueIds, paid.kind_configs.id, paid.entries.id]).size === uniqueIds.length + 2, 'TABLE_ALIAS_OR_COUNT')
  const paidConfigs = await table(paid.kind_configs, 'u32', N, `${pkg}::paid_access::KindPaidConfig`, PaidConfig)
  for (const row of paidConfigs) {
    const desc = await descriptor(row.key), v = row.value
    check(v.version === '1' && v.scope_mask === desc.default_grant_scope_mask && (BigInt(desc.read_mode_mask) & 4n) !== 0n
      && BigInt(v.ownership_epoch_snapshot) <= BigInt(state.ownership_epoch), 'PAID_CONFIG_MISMATCH')
  }
  const isOwner = viewerAddresses.includes(state.current_owner)
  const buyerRows = isOwner ? await table(paid.entries, 'address', A, `0x2::table::Table<u32,${pkg}::paid_access::KindPaidEntry>`, Table)
    : (await Promise.all(viewerAddresses.map(buyer => field(paid.entries.id, 'address', A, buyer,
      `0x2::table::Table<u32,${pkg}::paid_access::KindPaidEntry>`, Table, true)))).filter((row): row is NonNullable<typeof row> => row !== null)
  const entries = []
  const innerTableIds = new Set([...uniqueIds, paid.kind_configs.id, paid.entries.id])
  for (const buyer of buyerRows) {
    // add_access accepts any address, including @0x0. This is not an object
    // ID or grant::issue's explicitly nonzero grantee constraint.
    address(buyer.key); id(buyer.value.id)
    check(!innerTableIds.has(buyer.value.id) && BigInt(buyer.value.size) > 0n, 'BUYER_TABLE_ALIAS_OR_EMPTY')
    innerTableIds.add(buyer.value.id)
    for (const row of await table(buyer.value, 'u32', N, `${pkg}::paid_access::KindPaidEntry`, PaidEntry)) {
      const v = row.value, desc = await descriptor(row.key)
      check(v.version === '1' && v.scope_mask === desc.default_grant_scope_mask && (BigInt(desc.read_mode_mask) & 4n) !== 0n
        && BigInt(v.ownership_epoch_snapshot) <= BigInt(state.ownership_epoch), 'PAID_ENTRY_MISMATCH')
      entries.push({ buyerAddress: buyer.key, kind: row.key, entry: v, currentEpoch: v.ownership_epoch_snapshot === state.ownership_epoch })
    }
  }
  for (const kind of kindIds) await descriptor(kind)
  const clock = decode(Clock, (await read(CLOCK, '0x2::clock::Clock', 3, undefined, false, false))!)
  check(clock.id === CLOCK, 'CLOCK_MISMATCH')
  check(BigInt(descriptors.size) <= BigInt(registry.kinds.size), 'KIND_TABLE_COUNT')
  for (const [objectId, prior] of reads) await read(objectId, prior.type, prior.kind, prior.owner, prior.raw === null)
  signal.throwIfAborted()
  const unexpired = (expiry: string | null) => expiry === null || BigInt(clock.timestamp_ms) < BigInt(expiry)
  return freeze({ stateId, soulId: state.soul_id, stateVersion: String(stateRaw.version), stateDigest: stateRaw.digest!,
    currentOwner: state.current_owner, creator: state.creator, ownershipEpoch: state.ownership_epoch,
    grantCapacity: state.grant_capacity, activeGrantCount: state.active_grant_count, contentId: content.id, paidAccessListId: paid.id,
    observedAtMs: clock.timestamp_ms, config, contentVersions: versions, activeBindings: activeRows.map(r => r.value),
    kindDescriptors: [...descriptors.values()], grants: grants.map(g => ({ ...g, unexpiredAtObservation: unexpired(g.slot.expires_at_ms) })),
    paidAccessKindConfigs: paidConfigs.map(r => ({ kind: r.key, config: r.value, currentEpoch: r.value.ownership_epoch_snapshot === state.ownership_epoch })),
    paidAccessEntries: entries.map(e => ({ ...e, unexpiredAtObservation: unexpired(e.entry.expires_at_ms) })),
    paidEntriesScope: isOwner ? 'ALL_BUYERS' as const : 'VIEWER_ADDRESSES_ONLY' as const,
    unavailable: { databaseMemberIds: 'NO_CHAIN_FIELD', rowTimestamps: 'NO_CHAIN_FIELD', grantHistory: 'NOT_RETAINED_IN_CURRENT_TABLE',
      paidEntryPriceAndCreationTime: 'NO_CHAIN_FIELD', contentDeletionTimes: 'BOOLEANS_ONLY', contentBlobId: 'REQUIRES_BLOB_OBJECT_READ',
      contentSealSidecar: 'REQUIRES_SEPARATE_ENVELOPE_EVIDENCE',
      readme: 'REQUIRES_AUTHORIZED_CONTENT_READ' }, notAuthorization: true as const })
}

export type SoulDetailStateSnapshot = Awaited<ReturnType<typeof readSoulDetailState>>
