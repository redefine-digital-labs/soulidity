import { it, expect, vi } from 'vitest'
import { deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '../../packages/soulidity-sdk/src/kiosk-item-custody'
import { readFileSync } from 'node:fs'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { readSoulDetailState, SoulDetailStateBcs as D } from '../../packages/soulidity-sdk/src/soul-detail-state'
import { SoulStatePublicBcs, SoulPublicBcs, SoulContentPublicBcs, SoulContentKeyPublicBcs, SoulContentSlotPublicBcs } from '../../packages/soulidity-sdk/src/soul-public-read'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`, digest = toBase58(new Uint8Array(32).fill(1))
const A = bcs.Address, N = bcs.u32(), U = bcs.u64(), S = bcs.string(), V = bcs.vector(bcs.u8())
it.each([
  ['grant', 'SoulGrant', 'id:UID|version:u64|soul_id:ID|grantee:address|issued_by:address|ownership_epoch_snapshot:u64|scope_mask:u64|expires_at_ms:Option<u64>'],
  ['soul', 'ActiveGrantSlot', 'version:u64|grant_id:ID|grantee:address|scope_mask:u64|expires_at_ms:Option<u64>|ownership_epoch_snapshot:u64'],
  ['paid_access', 'KindPaidConfig', 'version:u64|price_atomic:u64|scope_mask:u64|duration_ms:Option<u64>|ownership_epoch_snapshot:u64'],
  ['paid_access', 'KindPaidEntry', 'version:u64|scope_mask:u64|expires_at_ms:Option<u64>|ownership_epoch_snapshot:u64'],
  ['content', 'ActiveBinding', 'version:u64|kind:u32|name:String|version_index:u64|download_policy:u8'],
  ['kind_registry', 'KindDescriptor', 'version:u64|kind:u32|name:String|op_mask:u64|read_mode_mask:u64|has_active_binding:bool|requires_download_policy:bool|default_grant_scope_mask:u64|deprecated:bool'],
])('current Move %s::%s BCS layout remains exact', (module, name, expected) => {
  const source = readFileSync(`move/soulidity/sources/${module}.move`, 'utf8').replace(/\/\/[^\n]*/g, '')
  const body = source.match(new RegExp(`public struct ${name}[^\\{]*\\{([^}]+)\\}`))?.[1]
  expect(body).toBeDefined()
  expect([...body!.matchAll(/([a-z_]+)\s*:\s*([^,]+),/g)].map(m => `${m[1]}:${m[2].replace(/\s/g, '')}`).join('|')).toBe(expected)
})
function fixture() {
  const deployment = { originalPackageId: id(1), chainIdentifier: '01010101', kindRegistryId: id(30) }, pkg = id(1)
  const state = { id: id(2), version: '1', soul_id: id(3), creator: id(4), creator_royalty_bps: 500,
    current_owner: id(5), current_kiosk_id: id(7), ownership_epoch: '2', grant_capacity: '3',
    active_grants: { id: id(8), size: '1' }, active_grant_ids: { id: id(9), size: '1' }, active_grant_count: '1',
    content_id: id(10), config_ext: { id: id(11), size: '1' }, collection_id: null, access_list_id: id(12), is_listed: false }
  const soul = { id: id(3), version: '1', name: 'Soul', description: '', image_url: '', provenance_kind: 1, origin_ref: null, creator: id(4) }
  const content = { id: id(10), version: '1', soul_id: id(3), items: { id: id(13), size: '1' },
    count_by_kind: { id: id(14), size: '1' }, active: { id: id(15), size: '1' } }
  const registry = { id: id(30), version: '1', next_kind: 16, kinds: { id: id(31), size: '5' }, name_to_kind: { id: id(32), size: '5' } }
  const descriptor = { version: '1', kind: 3, name: 'sprite', op_mask: '15', read_mode_mask: '15', has_active_binding: true,
    requires_download_policy: true, default_grant_scope_mask: '8', deprecated: false }
  const slot = { version: '1', kind: 3, blob_object_id: id(40), is_public: false, deleted: false, purged: false,
    download_policy: 1, grant_scope_mask: '8', read_mode_mask: '7', op_mask: '15', seal_encrypted: true, created_at_ms: '123' }
  const slots = [structuredClone(slot), { ...slot, blob_object_id: id(41), created_at_ms: '456' }]
  const active = { version: '1', kind: 3, name: 'main', version_index: '1', download_policy: 1 }
  const grantSlot = { version: '1', grant_id: id(50), grantee: id(51), scope_mask: '9', expires_at_ms: '2000' as string | null, ownership_epoch_snapshot: '2' }
  const grant = { id: id(50), version: '1', soul_id: id(3), grantee: id(51), issued_by: id(5),
    ownership_epoch_snapshot: '2', scope_mask: '9', expires_at_ms: '2000' as string | null }
  const paid = { id: id(12), version: '1', soul_id: id(3), creator: id(4), kind_configs: { id: id(60), size: '1' }, entries: { id: id(61), size: '2' } }
  const paidConfig = { version: '1', price_atomic: '0', scope_mask: '8', duration_ms: '0' as string | null, ownership_epoch_snapshot: '2' }
  const entry = { version: '1', scope_mask: '8', expires_at_ms: '2000' as string | null, ownership_epoch_snapshot: '2' }
  const rows = new Map<string, any>(), tables = new Map<string, any[]>()
  function put(objectId: string, type: string, bytes: Uint8Array, owner: any = { kind: 3, version: 1n }) {
    rows.set(objectId, { objectId, objectType: normalizeStructTag(type), version: 1n, digest, owner, contents: { value: bytes } })
  }
  function field(parent: string, keyType: string, keyCodec: any, key: any, valueType: string, valueCodec: any, value: any) {
    const keyBytes = keyCodec.serialize(key).toBytes(), fieldId = deriveDynamicFieldID(parent, keyType, keyBytes)
    put(fieldId, `0x2::dynamic_field::Field<${keyType},${valueType}>`, bcs.struct('Field', { id: A, name: keyCodec, value: valueCodec })
      .serialize({ id: fieldId, name: key, value }).toBytes(), { kind: 2, address: parent })
    const candidates = tables.get(parent) ?? []
    if (!candidates.some(c => c.fieldId === fieldId)) candidates.push({ fieldId, kind: 1, name: { name: keyType, value: keyBytes }, valueType })
    tables.set(parent, candidates); return fieldId
  }
  const putState = () => put(state.id, `${pkg}::soul::SoulState`, SoulStatePublicBcs.serialize(state).toBytes())
  const putContent = () => put(content.id, `${pkg}::content::SoulContent`, SoulContentPublicBcs.serialize(content).toBytes())
  const putRegistry = () => put(registry.id, `${pkg}::kind_registry::KindRegistry`, D.Registry.serialize(registry).toBytes())
  const putPaid = () => put(paid.id, `${pkg}::paid_access::SoulPaidAccessList`, D.Paid.serialize(paid).toBytes())
  const putSlots = () => field(content.items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs, { kind: 3, name: 'main' }, `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs), slots)
  const putActive = () => field(content.active.id, 'u32', N, 3, `${pkg}::content::ActiveBinding`, D.Active, active)
  const putDescriptor = () => field(registry.kinds.id, 'u32', N, 3, `${pkg}::kind_registry::KindDescriptor`, D.Descriptor, descriptor)
  const putGrantSlot = () => field(state.active_grants.id, 'address', A, id(51), `${pkg}::soul::ActiveGrantSlot`, D.GrantSlot, grantSlot)
  const putGrant = (owner = { kind: 1, address: id(51) }) => put(grant.id, `${pkg}::grant::SoulGrant`, D.Grant.serialize(grant).toBytes(), owner)
  const putPaidConfig = () => field(paid.kind_configs.id, 'u32', N, 3, `${pkg}::paid_access::KindPaidConfig`, D.PaidConfig, paidConfig)
  const putEntry = (tableId = id(62)) => field(tableId, 'u32', N, 3, `${pkg}::paid_access::KindPaidEntry`, D.PaidEntry, entry)
  putState(); putContent(); putRegistry(); putPaid(); putSlots(); putActive(); putDescriptor(); putGrantSlot(); putGrant(); putPaidConfig()
  const itemFieldId = deriveKioskItemFieldId(state.current_kiosk_id, soul.id)
  put(itemFieldId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs.serialize({ id: itemFieldId, name: { name: { id: soul.id } }, value: soul.id }).toBytes(),
    { kind: 2, address: state.current_kiosk_id })
  put(soul.id, `${pkg}::soul::Soul`, SoulPublicBcs.serialize(soul).toBytes(), { kind: 2, address: itemFieldId })
  put(id(6), '0x2::clock::Clock', D.Clock.serialize({ id: id(6), timestamp_ms: '1000' }).toBytes())
  const configId = field(state.config_ext.id, '0x1::string::String', S, 'sprite_config_json', 'vector<u8>', V, [...new TextEncoder().encode('{"frames":2}')])
  const countId = field(content.count_by_kind.id, 'u32', N, 3, 'u64', U, '1')
  const reverseKindId = field(registry.name_to_kind.id, '0x1::string::String', S, 'sprite', 'u32', N, 3)
  const reverseGrantId = field(state.active_grant_ids.id, '0x2::object::ID', A, grant.id, 'address', A, grant.grantee)
  field(paid.entries.id, 'address', A, id(51), `0x2::table::Table<u32,${pkg}::paid_access::KindPaidEntry>`, D.Table, { id: id(62), size: '1' })
  field(paid.entries.id, 'address', A, id(52), `0x2::table::Table<u32,${pkg}::paid_access::KindPaidEntry>`, D.Table, { id: id(63), size: '1' })
  putEntry(); putEntry(id(63))
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://grpc.example.com' })
  vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: digest })
  const batch = vi.spyOn(client.ledgerService, 'batchGetObjects').mockImplementation(((args: any) => Promise.resolve({ response: {
    objects: args.requests.map((r: any) => ({ result: rows.has(r.objectId) ? { oneofKind: 'object', object: structuredClone(rows.get(r.objectId)) }
      : { oneofKind: 'error', error: { code: 5 } } })) } })) as any)
  const list = vi.spyOn(client.stateService, 'listDynamicFields').mockImplementation(((args: any) => Promise.resolve({ response: {
    dynamicFields: structuredClone(tables.get(args.parent) ?? []) } })) as any)
  const read = (extra: Partial<Parameters<typeof readSoulDetailState>[0]> = {}) => readSoulDetailState({ client, deployment,
    stateId: state.id, expectedState: { version: '1', digest }, viewerAddresses: [state.current_owner], ...extra })
  return { client, deployment, state, soul, content, registry, descriptor, slots, active, grantSlot, grant, paid, paidConfig, entry,
    rows, tables, field, batch, list, read, putState, putContent, putRegistry, putPaid, putSlots, putActive, putDescriptor,
    putGrantSlot, putGrant, putPaidConfig, putEntry, configId, countId, reverseKindId, reverseGrantId }
}

it('reads complete raw typed content, active, config, grants and all owner paid rows without SQL defaults', async () => {
  const f = fixture(), r = await f.read()
  expect(r.contentVersions.map(v => v.versionIndex)).toEqual(['0', '1'])
  expect(r.activeBindings[0].version_index).toBe('1'); expect(r.config[0].valueUtf8).toBe('{"frames":2}')
  expect(r.grants[0].grant?.issued_by).toBe(f.state.current_owner); expect(r.grants[0].unexpiredAtObservation).toBe(true)
  expect(r.paidAccessEntries).toHaveLength(2); expect(r.paidEntriesScope).toBe('ALL_BUYERS')
  expect(r.paidAccessKindConfigs[0].config.duration_ms).toBe('0') // Move permits zero; no invented duration policy.
  expect(r.unavailable.contentSealSidecar).toBe('REQUIRES_SEPARATE_ENVELOPE_EVIDENCE')
  expect(r.notAuthorization).toBe(true); expect(Object.isFrozen(r.contentVersions[0].slot)).toBe(true)
})
it.each([{ viewers: [] }, { viewers: [id(51)] }, { viewers: [id(99)] }])('viewer paid scope is explicit and never exposes other buyers (%j)', async ({ viewers }) => {
  const f = fixture(), r = await f.read({ viewerAddresses: viewers })
  expect(r.paidEntriesScope).toBe('VIEWER_ADDRESSES_ONLY')
  expect(r.paidAccessEntries.map(e => e.buyerAddress)).toEqual(viewers.includes(id(51)) ? [id(51)] : [])
  expect(f.list.mock.calls.some(([args]) => args.parent === f.paid.entries.id || args.parent === id(63))).toBe(false)
})
it('ownership rotation invalidates old paid and grant slots without inventing removed history', async () => {
  const f = fixture(); f.state.ownership_epoch = '3'; f.state.active_grant_count = '0'; f.putState(); f.rows.delete(f.grant.id)
  const r = await f.read(); expect(r.grants[0]).toMatchObject({ currentEpoch: false, grant: null })
  expect(r.paidAccessEntries.every(e => !e.currentEpoch)).toBe(true); expect(r.paidAccessKindConfigs[0].currentEpoch).toBe(false)
})
it('a transferred Grant object does not change its fixed grantee or require grantee custody', async () => {
  const f = fixture(); f.putGrant({ kind: 1, address: id(99) })
  expect((await f.read()).grants[0].slot.grantee).toBe(id(51))
})
it('a Grant transferred to zero-address custody retains its fixed active grantee', async () => {
  const f = fixture(); f.putGrant({ kind: 1, address: id(0) })
  const r = await f.read(); expect(r.grants[0].slot.grantee).toBe(id(51)); expect(r.grants[0].currentEpoch).toBe(true)
})
it('expiration equality uses observed chain Clock, not client Date.now', async () => {
  const f = fixture(); f.grantSlot.expires_at_ms = '1000'; f.grant.expires_at_ms = '1000'; f.entry.expires_at_ms = '1000'
  f.putGrantSlot(); f.putGrant(); f.putEntry()
  const r = await f.read(); expect(r.observedAtMs).toBe('1000'); expect(r.grants[0].unexpiredAtObservation).toBe(false)
  expect(r.paidAccessEntries[0].unexpiredAtObservation).toBe(false)
})
it('deprecated Kind keeps historical content masks and names available', async () => {
  const f = fixture(); f.descriptor.deprecated = true; f.putDescriptor(); expect((await f.read()).contentVersions).toHaveLength(2)
})
it('count_by_kind is number of names, not number of versions', async () => {
  const f = fixture(); expect((await f.read()).contentVersions).toHaveLength(2)
  f.field(f.content.count_by_kind.id, 'u32', N, 3, 'u64', U, '2')
  await expect(f.read()).rejects.toThrow('CONTENT_COUNT_MISMATCH')
})
it('invalid UTF8 config retains exact bytes with explicit absent text, not replacement characters', async () => {
  const f = fixture(); f.field(f.state.config_ext.id, '0x1::string::String', S, 'sprite_config_json', 'vector<u8>', V, [255])
  expect((await f.read()).config[0]).toMatchObject({ valueBytes: [255], valueUtf8: null })
})
it('deleted/purged version keeps real flags and creation time, without fabricated deletion timestamps', async () => {
  const f = fixture(); f.slots[0].deleted = true; f.slots[0].purged = true; f.putSlots()
  const r = await f.read(); expect(r.contentVersions[0].slot).toMatchObject({ deleted: true, purged: true, created_at_ms: '123' })
  expect(r.unavailable.contentDeletionTimes).toBe('BOOLEANS_ONLY')
})
it('native-sized u64 values remain strings, not lossy JavaScript numbers', async () => {
  const f = fixture(); f.state.ownership_epoch = '9007199254740993'; f.state.active_grant_count = '0'; f.putState()
  f.paidConfig.price_atomic = '18446744073709551615'; f.putPaidConfig()
  const r = await f.read(); expect(r.ownershipEpoch).toBe('9007199254740993'); expect(r.paidAccessKindConfigs[0].config.price_atomic).toBe('18446744073709551615')
})
it('a missing current Grant object is unavailable, not silently removed from active grants', async () => {
  const f = fixture(); f.rows.delete(f.grant.id); await expect(f.read()).rejects.toThrow('OBJECT_UNAVAILABLE')
})
it('the exact viewer absence is reread so a new paid purchase cannot be hidden', async () => {
  const f = fixture(), buyer = id(99), target = deriveDynamicFieldID(f.paid.entries.id, 'address', A.serialize(buyer).toBytes())
  const original = f.batch.getMockImplementation()!; let count = 0
  f.batch.mockImplementation(((args: any) => {
    if (args.requests[0].objectId === target && ++count === 2) f.field(f.paid.entries.id, 'address', A, buyer,
      `0x2::table::Table<u32,${id(1)}::paid_access::KindPaidEntry>`, D.Table, { id: id(99), size: '0' })
    return original(args)
  }) as any)
  await expect(f.read({ viewerAddresses: [buyer] })).rejects.toThrow('CHANGED_RETRY')
})
it('paginated DF discovery validates every actual raw row and stable opaque tokens', async () => {
  const f = fixture(); f.state.config_ext.size = '2'; f.putState()
  f.field(f.state.config_ext.id, '0x1::string::String', S, 'voice_config_json', 'vector<u8>', V, [123, 125])
  const original = f.list.getMockImplementation()!
  f.list.mockImplementation(((args: any) => args.parent === f.state.config_ext.id ? Promise.resolve({ response: {
    dynamicFields: [structuredClone(f.tables.get(args.parent)![args.pageToken ? 1 : 0])], nextPageToken: args.pageToken ? undefined : new Uint8Array([9]) } }) : original(args)) as any)
  expect((await f.read()).config).toHaveLength(2)
  expect(f.list.mock.calls.filter(([a]) => a.parent === f.state.config_ext.id)).toHaveLength(2)
})
it.each(['duplicate', 'cursor', 'too-many', 'bad-kind', 'wrong-id', 'wrong-keytype', 'wrong-valuetype', 'truncated'])('discovery %s fails, never supplies authoritative or silently truncated arrays', async issue => {
  const f = fixture(), original = f.list.getMockImplementation()!
  f.list.mockImplementation(((args: any) => {
    if (args.parent !== f.state.config_ext.id) return original(args)
    const candidate = structuredClone(f.tables.get(args.parent)![0])
    if (issue === 'bad-kind') candidate.kind = 2
    if (issue === 'wrong-id') candidate.fieldId = id(99)
    if (issue === 'wrong-keytype') candidate.name.name = 'address'
    if (issue === 'wrong-valuetype') candidate.valueType = 'u64'
    return Promise.resolve({ response: { dynamicFields: issue === 'duplicate' ? [candidate, candidate] : issue === 'too-many' ? Array(51).fill(candidate)
      : issue === 'truncated' || issue === 'cursor' ? [] : [candidate], ...(issue === 'cursor' ? { nextPageToken: new Uint8Array([9]) } : {}) } })
  }) as any)
  await expect(f.read()).rejects.toThrow()
})
it.each(['uid', 'type', 'owner', 'birth', 'version', 'digest', 'tail'])('raw DF %s tamper is rejected', async issue => {
  const f = fixture(), row = f.rows.get(f.configId)
  if (issue === 'uid') row.contents.value = bcs.struct('Field', { id: A, name: S, value: V }).serialize({ id: id(99), name: 'sprite_config_json', value: [1] }).toBytes()
  if (issue === 'type') row.objectType = `${id(99)}::bad::Field`
  if (issue === 'owner') row.owner.address = id(99)
  if (issue === 'birth') f.rows.get(f.state.id).owner.version = 2n
  if (issue === 'version') row.version = '1'
  if (issue === 'digest') row.digest = 'bad'
  if (issue === 'tail') row.contents.value = new Uint8Array([...row.contents.value, 0])
  await expect(f.read()).rejects.toThrow()
})
it.each(['soul_id', 'id', 'version'])('content root %s must bind State exactly', async key => {
  const f = fixture(); const value = { ...f.content, [key]: key === 'version' ? '2' : id(99) }
  f.rows.get(f.content.id).contents.value = SoulContentPublicBcs.serialize(value).toBytes()
  await expect(f.read()).rejects.toThrow('CONTENT_MISMATCH')
})
it.each(['kind', 'version', 'grant_scope_mask', 'read_mode_mask', 'op_mask', 'seal_encrypted', 'is_public', 'purged', 'download_policy'])('slot %s must match frozen actual descriptor semantics', async key => {
  const f = fixture(); (f.slots[0] as any)[key] = ['seal_encrypted', 'is_public', 'purged'].includes(key) ? key !== 'seal_encrypted'
    : key === 'version' ? '2' : key === 'kind' ? 4 : key === 'download_policy' ? 3 : key === 'read_mode_mask' ? '16' : '0'
  f.putSlots(); await expect(f.read()).rejects.toThrow()
})
it.each(['name', 'kind', 'version_index', 'download_policy'])('active binding %s cannot select a different/missing slot', async key => {
  const f = fixture(); (f.active as any)[key] = key === 'name' ? 'missing' : key === 'version_index' ? '99' : key === 'kind' ? 4 : 0
  f.putActive(); await expect(f.read()).rejects.toThrow('ACTIVE_BINDING_MISMATCH')
})
it.each(['grant_id', 'grantee', 'ownership_epoch_snapshot', 'scope_mask'])('slot/index %s mismatch fails', async key => {
  const f = fixture(); (f.grantSlot as any)[key] = key === 'scope_mask' ? '0' : key === 'ownership_epoch_snapshot' ? '3' : id(99)
  f.putGrantSlot(); await expect(f.read()).rejects.toThrow()
})
it.each(['issued_by', 'grantee', 'soul_id', 'scope_mask', 'expires_at_ms'])('current Grant object %s mismatch fails', async key => {
  const f = fixture(); (f.grant as any)[key] = key === 'scope_mask' ? '1' : key === 'expires_at_ms' ? '1999' : id(99)
  f.putGrant(); await expect(f.read()).rejects.toThrow('GRANT_MISMATCH')
})
it('active grant count cannot be invented from a stale table size', async () => {
  const f = fixture(); f.state.active_grant_count = '0'; f.putState(); await expect(f.read()).rejects.toThrow('GRANT_COUNT_MISMATCH')
})
it.each(['scope_mask', 'ownership_epoch_snapshot', 'version'])('paid entry %s must match current schema/Kind and nonfuture epoch', async key => {
  const f = fixture(); (f.entry as any)[key] = key === 'scope_mask' ? '1' : key === 'version' ? '2' : '3'; f.putEntry()
  await expect(f.read()).rejects.toThrow('PAID_ENTRY_MISMATCH')
})
it.each(['state', 'slot', 'config', 'paid', 'registry', 'grant'])('reread %s drift is visible even when a malicious response reuses digest', async key => {
  const f = fixture(), target = ({ state: f.state.id, slot: f.putSlots(), config: f.configId, paid: f.paid.id, registry: f.registry.id, grant: f.grant.id })[key]!
  const original = f.batch.getMockImplementation()!; let count = 0
  f.batch.mockImplementation(((args: any) => { if (args.requests[0].objectId === target && ++count === 2)
    f.rows.get(target).contents.value = new Uint8Array([...f.rows.get(target).contents.value, 0]); return original(args) }) as any)
  await expect(f.read()).rejects.toThrow('CHANGED_RETRY')
})
it('owner paid full list budget cannot be silently replaced by an empty subset', async () => {
  const f = fixture(); f.paid.entries.size = '2001'; f.putPaid(); await expect(f.read()).rejects.toThrow('TABLE_BUDGET')
})
it('two buyers cannot share a forged inner access table', async () => {
  const f = fixture(); f.field(f.paid.entries.id, 'address', A, id(52),
    `0x2::table::Table<u32,${id(1)}::paid_access::KindPaidEntry>`, D.Table, { id: id(62), size: '1' })
  await expect(f.read()).rejects.toThrow('BUYER_TABLE_ALIAS_OR_EMPTY')
})
it('owner detail preserves a legitimate zero-address paid buyer from add_access', async () => {
  const f = fixture(); f.paid.entries.size = '3'; f.putPaid()
  f.field(f.paid.entries.id, 'address', A, id(0),
    `0x2::table::Table<u32,${id(1)}::paid_access::KindPaidEntry>`, D.Table, { id: id(64), size: '1' })
  f.putEntry(id(64))
  const r = await f.read()
  expect(r.paidEntriesScope).toBe('ALL_BUYERS')
  expect(r.paidAccessEntries).toHaveLength(3)
  expect(r.paidAccessEntries.find(e => e.buyerAddress === id(0))).toMatchObject({ kind: 3,
    entry: { scope_mask: '8', ownership_epoch_snapshot: '2' }, currentEpoch: true })
})
it('missing viewer field only accepts explicit gRPC NOT_FOUND, not outages', async () => {
  const f = fixture(), original = f.batch.getMockImplementation()!, target = deriveDynamicFieldID(f.paid.entries.id, 'address', A.serialize(id(99)).toBytes())
  f.batch.mockImplementation(((args: any) => args.requests[0].objectId === target ? Promise.resolve({ response: { objects: [
    { result: { oneofKind: 'error', error: { code: 14 } } }] } }) : original(args)) as any)
  await expect(f.read({ viewerAddresses: [id(99)] })).rejects.toThrow('OBJECT_UNAVAILABLE')
})
it('requires exact metadata State reference', async () => {
  const f = fixture(); await expect(f.read({ expectedState: { version: '2', digest } })).rejects.toThrow('STALE_METADATA')
})
it('clones viewer/deployment references before await and returns detached snapshots', async () => {
  const f = fixture(), viewers = [id(51)], pending = f.read({ viewerAddresses: viewers }); viewers.push(f.state.current_owner); f.deployment.kindRegistryId = id(99)
  const r = await pending; expect(r.paidEntriesScope).toBe('VIEWER_ADDRESSES_ONLY'); expect(r.paidAccessEntries).toHaveLength(1)
  f.entry.scope_mask = '1'; expect(r.paidAccessEntries[0].entry.scope_mask).toBe('8')
})
it('abort interrupts noncompliant pending pagination and prevents further reads', async () => {
  const f = fixture(); f.list.mockImplementationOnce(() => new Promise(() => {}) as any)
  const c = new AbortController(), p = f.read({ signal: c.signal }); await vi.waitFor(() => expect(f.list).toHaveBeenCalled())
  c.abort(new Error('cancel detail')); await expect(p).rejects.toThrow('cancel detail')
})
