import { it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { readSoulPublicSnapshot, readSoulPublicSnapshotBySoulId, SoulStatePointerKeyV1Bcs, SoulStatePointerFieldV1Bcs,
  SoulPublicBcs, SoulStatePublicBcs, SoulContentPublicBcs,
  SoulContentKeyPublicBcs, SoulContentSlotPublicBcs, SOUL_PUBLIC_MAX_SOUL_BYTES } from '../../packages/soulidity-sdk/src/soul-public-read'
import { validateSoulPublishArgs } from '../../packages/soulidity-sdk/src/tx/shared'
import { buildSoulPublicPreviewStateConfig } from '../../packages/soulidity-sdk/src/soul-public-preview'
import { NativeSoulBcs, NativeSoulStateBcs } from '../../web/lib/animacraft/native-receive'
import { createSoulAuthoredDiscovery } from '../../packages/soulidity-sdk/src/soul-authored-discovery'
import { deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '../../packages/soulidity-sdk/src/kiosk-item-custody'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = toBase58(new Uint8Array(32).fill(1))
function fixture() {
  const deployment = { originalPackageId: id(1), chainIdentifier: '01010101' }, pkg = deployment.originalPackageId
  const state = { id: id(2), version: '1', soul_id: id(3), creator: id(4), creator_royalty_bps: 500,
    current_owner: id(5), current_kiosk_id: id(6), ownership_epoch: '2', grant_capacity: '3',
    active_grants: { id: id(7), size: '2' }, active_grant_ids: { id: id(8), size: '2' }, active_grant_count: '0',
    content_id: id(9), config_ext: { id: id(10), size: '1' }, collection_id: null as string | null,
    access_list_id: id(11), is_listed: false }
  const soul = { id: id(3), version: '1', name: 'A real Soul', description: 'Description', image_url: 'https://images.example.com/a.png',
    provenance_kind: 1, origin_ref: null as string | null, creator: id(4) }
  const content = { id: id(9), version: '1', soul_id: id(3), items: { id: id(12), size: '2' },
    count_by_kind: { id: id(13), size: '2' }, active: { id: id(14), size: '0' } }
  const slot = { version: '1', kind: 0, blob_object_id: id(15), is_public: false, deleted: false, purged: false,
    download_policy: 0, grant_scope_mask: '1', read_mode_mask: '3', op_mask: '0', seal_encrypted: true, created_at_ms: '1789060000000' }
  const config = buildSoulPublicPreviewStateConfig({ tags: [' OC ', 'cat'], previewImages: ['https://images.example.com/preview.png'] })
  const configId = deriveDynamicFieldID(state.config_ext.id, '0x1::string::String', bcs.string().serialize(config.key).toBytes())
  const key = { kind: 0, name: 'soul' }, keyType = `${pkg}::content::ContentKey`
  const slotId = deriveDynamicFieldID(content.items.id, keyType, SoulContentKeyPublicBcs.serialize(key).toBytes())
  const pointerKeyType = `${pkg}::soul::SoulStatePointerKeyV1`
  const pointerId = deriveDynamicFieldID(soul.id, pointerKeyType, new Uint8Array([1]))
  const pointer = { id: pointerId, name: { version: 1 }, value: state.id }
  const configField = bcs.struct('ConfigField', { id: bcs.Address, name: bcs.string(), value: bcs.vector(bcs.u8()) })
  const slotsField = bcs.struct('SlotsField', { id: bcs.Address, name: SoulContentKeyPublicBcs, value: bcs.vector(SoulContentSlotPublicBcs) })
  const rows = new Map<string, any>()
  function put(objectId: string, type: string, bytes: Uint8Array, owner: any) {
    rows.set(objectId, { objectId, objectType: normalizeStructTag(type), version: 1n, digest, owner, contents: { value: bytes } })
  }
  function putState() { put(state.id, `${pkg}::soul::SoulState`, SoulStatePublicBcs.serialize(state).toBytes(), { kind: 3, version: 1n }) }
  function putSoul() {
    const fieldId = deriveKioskItemFieldId(state.current_kiosk_id, soul.id)
    put(fieldId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs.serialize({ id: fieldId, name: { name: { id: soul.id } }, value: soul.id }).toBytes(),
      { kind: 2, address: state.current_kiosk_id })
    put(soul.id, `${pkg}::soul::Soul`, SoulPublicBcs.serialize(soul).toBytes(), { kind: 2, address: fieldId })
  }
  function putContent() { put(content.id, `${pkg}::content::SoulContent`, SoulContentPublicBcs.serialize(content).toBytes(), { kind: 3, version: 1n }) }
  function putConfig(text = config.valueUtf8) {
    put(configId, '0x2::dynamic_field::Field<0x1::string::String,vector<u8>>', configField.serialize({
      id: configId, name: config.key, value: [...new TextEncoder().encode(text)] }).toBytes(), { kind: 2, address: state.config_ext.id })
  }
  function putSlot(slots = [slot]) {
    put(slotId, `0x2::dynamic_field::Field<${keyType},vector<${pkg}::content::ContentSlot>>`,
      slotsField.serialize({ id: slotId, name: key, value: slots }).toBytes(), { kind: 2, address: content.items.id })
  }
  function putPointer() {
    put(pointerId, `0x2::dynamic_field::Field<${pointerKeyType},0x2::object::ID>`,
      SoulStatePointerFieldV1Bcs.serialize(pointer).toBytes(), { kind: 2, address: soul.id })
  }
  putState(); putSoul(); putContent(); putConfig(); putSlot(); putPointer()
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://grpc.example.com' })
  vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: digest })
  const get = vi.spyOn(client.ledgerService, 'getObject').mockImplementation(((args: any) => {
    const value = rows.get(args.objectId)
    if (!value) return Promise.reject(Object.assign(new Error('not found'), { code: 'NOT_FOUND' }))
    return Promise.resolve({ response: { object: structuredClone(value) } })
  }) as any)
  const read = (signal?: AbortSignal) => readSoulPublicSnapshot({ client, deployment, stateId: state.id, signal })
  const readBySoul = (signal?: AbortSignal) => readSoulPublicSnapshotBySoulId({ client, deployment, soulId: soul.id, signal })
  return { client, deployment, state, soul, content, slot, config, configId, slotId, rows, get,
    putState, putSoul, putContent, putConfig, putSlot, read, pointer, pointerId, pointerKeyType, putPointer, readBySoul }
}

it('reads exact Soul/State custody, actual public arrays and immutable initial Clock time without fetching private content', async () => {
  const f = fixture(), result = await f.read()
  expect(result).toMatchObject({ soulId: f.soul.id, stateId: f.state.id, creator: id(4), currentOwner: id(5), kioskId: id(6),
    name: f.soul.name, description: f.soul.description, imageUrl: f.soul.image_url, provenanceKind: 1,
    ownershipEpoch: '2', createdAtMs: f.slot.created_at_ms, publicPreview: { tags: ['oc', 'cat'], previewImages: ['https://images.example.com/preview.png'] },
    listedIndividually: false })
  expect(result).not.toHaveProperty('updatedAt'); expect(result).not.toHaveProperty('listingPrice')
  expect(f.get).toHaveBeenCalledTimes(12)
  expect(f.get.mock.calls.every(([args]: any[]) => args.objectId !== f.slot.blob_object_id)).toBe(true)
  expect(f.get.mock.calls[0][0]).toMatchObject({ readMask: { paths: ['object_id', 'object_type', 'version', 'digest', 'owner', 'contents'] } })
})
it.each(['missing', 'parent', 'type', 'uid', 'key', 'value', 'trailing', 'direct-kiosk', 'changed'] as const)(
  'rejects invalid Kiosk item field proof: %s', async problem => {
    const f = fixture(), fieldId = deriveKioskItemFieldId(f.state.current_kiosk_id, f.soul.id)
    const raw = f.rows.get(fieldId), field = KioskItemFieldBcs.parse(raw.contents.value)
    if (problem === 'missing') f.rows.delete(fieldId)
    if (problem === 'parent') raw.owner.address = id(99)
    if (problem === 'type') raw.objectType = '0x2::dynamic_field::Field<u8,0x2::object::ID>'
    if (problem === 'uid') field.id = id(99)
    if (problem === 'key') field.name.name.id = id(99)
    if (problem === 'value') field.value = id(99)
    if (['uid', 'key', 'value'].includes(problem)) raw.contents.value = KioskItemFieldBcs.serialize(field).toBytes()
    if (problem === 'trailing') raw.contents.value = new Uint8Array([...raw.contents.value, 0])
    if (problem === 'direct-kiosk') f.rows.get(f.soul.id).owner.address = f.state.current_kiosk_id
    if (problem === 'changed') {
      const original = f.get.getMockImplementation()!; let reads = 0
      f.get.mockImplementation(((args: any) => {
        if (args.objectId === fieldId && ++reads === 2) raw.version = 2n
        return original(args)
      }) as any)
    }
    await expect(f.read()).rejects.toThrow()
  })
it('connects checkpoint candidates through the actual raw reader to authored results, not holder inventory', async () => {
  const f = fixture()
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ data: {
    chainIdentifier: digest, checkpoint: { sequenceNumber: 100, query: { objects: { nodes: [{ address: f.state.id }],
      pageInfo: { hasNextPage: false, endCursor: 'opaque:final' } } } },
  } })))
  const options = { client: f.client, deployment: f.deployment, creator: f.state.creator,
    discovery: { endpoint: 'https://graphql.example.com/graphql', pageSize: 10, maxPages: 2, maxObjects: 20, timeoutMs: 1000, fetch: fetcher } }
  const result = await createSoulAuthoredDiscovery(options).next()
  expect(result).toMatchObject({ candidateStatus: 'COMPLETE', authoredCount: 1, verifiedCandidates: 1 })
  expect(result.souls[0]).toMatchObject({ soulId: f.soul.id, creator: id(4), currentOwner: id(5), createdAtMs: f.slot.created_at_ms })
  expect(f.get).toHaveBeenCalledTimes(12)
  expect((await createSoulAuthoredDiscovery({ ...options, creator: f.state.current_owner }).next()).souls).toEqual([])
})
it('matches the established Native Soul and State BCS layouts while preserving distinct creator and current owner', () => {
  const f = fixture()
  expect(SoulPublicBcs.serialize(f.soul).toBase64()).toBe(NativeSoulBcs.serialize(f.soul).toBase64())
  expect(SoulStatePublicBcs.serialize(f.state).toBase64()).toBe(NativeSoulStateBcs.serialize(f.state).toBase64())
})
it.each([4096, 16384])('accepts combined maximum SDK metadata and a free-form %i-byte origin', async originBytes => {
  const f = fixture()
  f.soul.name = 'n'.repeat(256); f.soul.description = 'd'.repeat(4096)
  f.soul.image_url = 'https://images.example.com/'.padEnd(1023, 'a')
  f.soul.origin_ref = 'r'.repeat(originBytes)
  validateSoulPublishArgs({ name: f.soul.name, description: f.soul.description, imageUrl: f.soul.image_url, creatorRoyaltyBps: 500 })
  f.putSoul()
  expect(f.rows.get(f.soul.id).contents.value.length).toBeGreaterThan(8192)
  expect(await f.read()).toMatchObject({ name: f.soul.name, description: f.soul.description, imageUrl: f.soul.image_url, originRef: f.soul.origin_ref })
})
it('does not invent writer UX restrictions for raw Move strings', async () => {
  const f = fixture(); f.soul.name = 'n'.repeat(257); f.soul.description = ''; f.putSoul()
  expect(await f.read()).toMatchObject({ name: f.soul.name, description: '' })
})
it('reports a reader resource limit separately from malformed asset data', async () => {
  const f = fixture(); f.rows.get(f.soul.id).contents.value = new Uint8Array(SOUL_PUBLIC_MAX_SOUL_BYTES + 1)
  await expect(f.read()).rejects.toThrow('SOUL_PUBLIC_READ_BUDGET_EXCEEDED')
  expect(f.get).toHaveBeenCalledTimes(3)
})
it('accepts explicit empty metadata, transferred Soul stale grant rows, and lossless creation time', async () => {
  const f = fixture(); f.putConfig(buildSoulPublicPreviewStateConfig({ tags: [], previewImages: [] }).valueUtf8)
  f.slot.created_at_ms = '18446744073709551615'; f.putSlot()
  expect(await f.read()).toMatchObject({ publicPreview: { tags: [], previewImages: [] }, createdAtMs: '18446744073709551615', creator: id(4), currentOwner: id(5) })
})
it('listed/collection/native metadata is factual context, never an inferred price, Maker author or purchase approval', async () => {
  const f = fixture(); f.state.is_listed = true; f.state.collection_id = id(21); f.putState()
  f.soul.provenance_kind = 3; f.soul.image_url = 'walrus://ciphertext'; f.putSoul()
  const value = await f.read()
  expect(value).toMatchObject({ listedIndividually: true, collectionId: id(21), provenanceKind: 3, imageUrl: 'walrus://ciphertext' })
  expect(value).not.toHaveProperty('purchaseAvailable'); expect(value).not.toHaveProperty('makerCreator')
})
it.each(['state', 'soul', 'content', 'preview', 'initial'])('missing %s evidence is an error, never an empty/default card', async part => {
  const f = fixture(), targets: Record<string, string> = { state: f.state.id, soul: f.soul.id, content: f.content.id, preview: f.configId, initial: f.slotId }
  f.rows.delete(targets[part]); await expect(f.read()).rejects.toThrow('not found')
})
it.each(['type', 'owner', 'id', 'digest', 'version', 'trailing'])('rejects substituted raw state %s', async part => {
  const f = fixture(), row = f.rows.get(f.state.id)
  if (part === 'type') row.objectType = `${id(90)}::soul::SoulState`
  if (part === 'owner') row.owner = { kind: 1, address: id(5) }
  if (part === 'id') row.objectId = id(90)
  if (part === 'digest') row.digest = 'bad'
  if (part === 'version') row.version = 0n
  if (part === 'trailing') row.contents.value = new Uint8Array([...row.contents.value, 0])
  await expect(f.read()).rejects.toThrow()
})
it.each(['uid', 'creator', 'kiosk', 'schema', 'provenance'])('rejects mismatched Soul %s', async part => {
  const f = fixture()
  if (part === 'uid') f.soul.id = id(90)
  if (part === 'creator') f.soul.creator = id(90)
  if (part === 'schema') f.soul.version = '2'
  if (part === 'provenance') f.soul.provenance_kind = 9
  // Preserve requested row identity while corrupting only its actual contents.
  f.rows.get(f.state.soul_id).contents.value = SoulPublicBcs.serialize(f.soul).toBytes()
  if (part === 'kiosk') f.rows.get(f.state.soul_id).owner.address = id(90)
  await expect(f.read()).rejects.toThrow()
})
it.each(['uid', 'name', 'owner', 'private', 'malformed'])('rejects forged public preview field %s', async part => {
  const f = fixture(), row = f.rows.get(f.configId)
  if (part === 'uid') row.contents.value.set(bcs.Address.serialize(id(90)).toBytes(), 0)
  if (part === 'name') row.contents.value[33] ^= 1
  if (part === 'owner') row.owner.address = id(90)
  if (part === 'private') f.putConfig(JSON.stringify({ ...JSON.parse(f.config.valueUtf8), dek: 'private' }))
  if (part === 'malformed') f.putConfig('{')
  await expect(f.read()).rejects.toThrow()
})
it.each(['wrong-root', 'wrong-key', 'many', 'none', 'deleted', 'public', 'mutable', 'unencrypted'])('rejects initial timestamp from %s content', async part => {
  const f = fixture()
  if (part === 'wrong-root') { f.content.soul_id = id(90); f.putContent() }
  if (part === 'wrong-key') f.rows.get(f.slotId).contents.value[32] = 1
  if (part === 'many') f.putSlot([f.slot, f.slot])
  if (part === 'none') f.putSlot([])
  if (part === 'deleted') { f.slot.deleted = true; f.putSlot() }
  if (part === 'public') { f.slot.is_public = true; f.putSlot() }
  if (part === 'mutable') { f.slot.op_mask = '1'; f.putSlot() }
  if (part === 'unencrypted') { f.slot.seal_encrypted = false; f.putSlot() }
  await expect(f.read()).rejects.toThrow()
})
it.each(['state', 'soul', 'preview', 'content', 'initial'])('a concurrent %s change invalidates the entire read set', async part => {
  const f = fixture(), targets: Record<string, string> = { state: f.state.id, soul: f.soul.id, content: f.content.id, preview: f.configId, initial: f.slotId }
  const original = f.get.getMockImplementation()!, counts = new Map<string, number>()
  f.get.mockImplementation(((args: any) => {
    counts.set(args.objectId, (counts.get(args.objectId) ?? 0) + 1)
    if (args.objectId === targets[part] && counts.get(args.objectId) === 2) f.rows.get(args.objectId).version = 2n
    return original(args)
  }) as any)
  await expect(f.read()).rejects.toThrow('SOUL_PUBLIC_CHANGED_RETRY')
})
it('rejects wrong chain and cancellation before object reads, including a client that ignores abort', async () => {
  const f = fixture(); vi.mocked(f.client.core.getChainIdentifier).mockResolvedValueOnce({ chainIdentifier: toBase58(new Uint8Array(32).fill(9)) })
  await expect(f.read()).rejects.toThrow('SOUL_PUBLIC_WRONG_CHAIN'); expect(f.get).not.toHaveBeenCalled()
  vi.mocked(f.client.core.getChainIdentifier).mockImplementationOnce(() => new Promise(() => {}))
  const controller = new AbortController(), reading = f.read(controller.signal)
  controller.abort(new Error('cancelled')); await expect(reading).rejects.toThrow('cancelled')
  expect(f.get).not.toHaveBeenCalled()
})

it('matches the actual immutable Move pointer key and Field<ID> wire layout', () => {
  const source = readFileSync('move/soulidity/sources/soul.move', 'utf8')
  expect(source).toMatch(/public struct SoulStatePointerKeyV1 has copy, drop, store\s*\{\s*version: u8,/)
  expect(source).toContain('df::add(&mut soul.id, SoulStatePointerKeyV1 { version: 1 }, object::id(state))')
  const f = fixture()
  expect(SoulStatePointerKeyV1Bcs.serialize({ version: 1 }).toBytes()).toEqual(new Uint8Array([1]))
  const independent = bcs.struct('Field', { id: bcs.struct('UID', { id: bcs.struct('ID', { bytes: bcs.Address }) }),
    name: bcs.struct('Key', { version: bcs.u8() }), value: bcs.struct('ID', { bytes: bcs.Address }) })
  expect(SoulStatePointerFieldV1Bcs.serialize(f.pointer).toBytes()).toEqual(independent.serialize({
    id: { id: { bytes: f.pointerId } }, name: { version: 1 }, value: { bytes: f.state.id },
  }).toBytes())
  expect(f.rows.get(f.pointerId).contents.value).toHaveLength(65)
})

it('resolves a fresh Soul deep link through its exact pointer into one stable raw snapshot', async () => {
  const f = fixture(), result = await f.readBySoul()
  expect(result).toMatchObject({ soulId: f.soul.id, stateId: f.state.id, stateVersion: '1', stateDigest: digest,
    currentOwner: f.state.current_owner, kioskId: f.state.current_kiosk_id, publicPreview: { tags: ['oc', 'cat'] } })
  expect(f.get).toHaveBeenCalledTimes(14)
  expect(f.get.mock.calls.map(([request]) => request.objectId)).toEqual([
    f.pointerId, f.state.id, deriveKioskItemFieldId(f.state.current_kiosk_id, f.soul.id), f.soul.id, f.configId, f.content.id, f.slotId,
    f.pointerId, f.state.id, deriveKioskItemFieldId(f.state.current_kiosk_id, f.soul.id), f.soul.id, f.configId, f.content.id, f.slotId,
  ])
  expect(f.client.core.getChainIdentifier).toHaveBeenCalledTimes(1)
})

it('keeps current owner distinct from creator and lossless State versions when following the pointer', async () => {
  const f = fixture(); f.rows.get(f.state.id).version = 18446744073709551615n
  expect(await f.readBySoul()).toMatchObject({ creator: f.state.creator, currentOwner: f.state.current_owner,
    stateVersion: '18446744073709551615', ownershipEpoch: '2' })
})

it.each(['missing', 'foreign-type', 'old-key-type', 'wrong-value-type', 'parent', 'address-owned',
  'raw-id', 'uid', 'key-version', 'zero-state', 'self-state', 'field-state', 'truncated', 'oversized',
  'version-zero', 'digest', 'wrong-state-soul', 'wrong-state-uid', 'state-address-owned', 'soul-custody']) (
  'Soul pointer rejects %s without a State scan or fallback', async part => {
    const f = fixture(), row = f.rows.get(f.pointerId)
    if (part === 'missing') f.rows.delete(f.pointerId)
    if (part === 'foreign-type') row.objectType = normalizeStructTag(`0x2::dynamic_field::Field<${id(90)}::soul::SoulStatePointerKeyV1,0x2::object::ID>`)
    if (part === 'old-key-type') row.objectType = normalizeStructTag(`0x2::dynamic_field::Field<u8,0x2::object::ID>`)
    if (part === 'wrong-value-type') row.objectType = normalizeStructTag(`0x2::dynamic_field::Field<${f.pointerKeyType},address>`)
    if (part === 'parent') row.owner.address = id(90)
    if (part === 'address-owned') row.owner.kind = 1
    if (part === 'raw-id') row.objectId = id(90)
    if (part === 'uid') { f.pointer.id = id(90); f.putPointer() }
    if (part === 'key-version') { f.pointer.name.version = 2; f.putPointer() }
    if (part === 'zero-state') { f.pointer.value = id(0); f.putPointer() }
    if (part === 'self-state') { f.pointer.value = f.soul.id; f.putPointer() }
    if (part === 'field-state') { f.pointer.value = f.pointerId; f.putPointer() }
    if (part === 'truncated') row.contents.value = row.contents.value.slice(0, 64)
    if (part === 'oversized') row.contents.value = new Uint8Array([...row.contents.value, 0])
    if (part === 'version-zero') row.version = 0n
    if (part === 'digest') row.digest = 'bad'
    if (part === 'wrong-state-soul') { f.state.soul_id = id(90); f.putState() }
    if (part === 'wrong-state-uid') {
      f.rows.get(f.state.id).contents.value = SoulStatePublicBcs.serialize({ ...f.state, id: id(90) }).toBytes()
    }
    if (part === 'state-address-owned') f.rows.get(f.state.id).owner = { kind: 1, address: f.state.current_owner }
    if (part === 'soul-custody') f.rows.get(f.soul.id).owner.address = id(90)
    await expect(f.readBySoul()).rejects.toThrow()
    // No dynamic-field directory or chain discovery API exists on this client
    // path; even absence is surfaced from the exact requested field.
    expect(f.get.mock.calls[0][0].objectId).toBe(f.pointerId)
  },
)

it.each(['pointer', 'state', 'soul', 'preview', 'content', 'initial'])('Soul deep link rejects concurrent %s drift', async part => {
  const f = fixture(), target: Record<string, string> = { pointer: f.pointerId, state: f.state.id, soul: f.soul.id,
    preview: f.configId, content: f.content.id, initial: f.slotId }
  const original = f.get.getMockImplementation()!, counts = new Map<string, number>()
  f.get.mockImplementation(((args: any) => {
    counts.set(args.objectId, (counts.get(args.objectId) ?? 0) + 1)
    if (args.objectId === target[part] && counts.get(args.objectId) === 2) f.rows.get(args.objectId).version = 2n
    return original(args)
  }) as any)
  await expect(f.readBySoul()).rejects.toThrow('SOUL_PUBLIC_CHANGED_RETRY')
})

it('rejects pointer bytes changing on reread even with an unchanged version and digest', async () => {
  const f = fixture(), original = f.get.getMockImplementation()!
  let count = 0
  f.get.mockImplementation(((args: any) => {
    if (args.objectId === f.pointerId && ++count === 2) { f.pointer.value = id(90); f.putPointer() }
    return original(args)
  }) as any)
  await expect(f.readBySoul()).rejects.toThrow('SOUL_PUBLIC_CHANGED_RETRY')
})

it('rejects shared birth versions above current version or changing within the read set', async () => {
  const invalid = fixture(); invalid.rows.get(invalid.state.id).owner.version = 2n
  await expect(invalid.readBySoul()).rejects.toThrow('SOUL_PUBLIC_CUSTODY_MISMATCH')
  const f = fixture(); f.rows.get(f.state.id).version = 3n
  const original = f.get.getMockImplementation()!; let count = 0
  f.get.mockImplementation(((args: any) => {
    if (args.objectId === f.state.id && ++count === 2) f.rows.get(f.state.id).owner.version = 2n
    return original(args)
  }) as any)
  await expect(f.readBySoul()).rejects.toThrow('SOUL_PUBLIC_CHANGED_RETRY')
})

it('snapshots deployment and Soul target before awaiting the chain lookup', async () => {
  const f = fixture(), request = { client: f.client, deployment: { ...f.deployment }, soulId: f.soul.id }
  let release!: (value: { chainIdentifier: string }) => void
  vi.mocked(f.client.core.getChainIdentifier).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const reading = readSoulPublicSnapshotBySoulId(request)
  request.soulId = id(90); request.deployment.originalPackageId = id(90); request.deployment.chainIdentifier = '09090909'
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  release({ chainIdentifier: digest })
  expect(await reading).toMatchObject({ soulId: f.soul.id, stateId: f.state.id })
})

it('fails closed on wrong chain before reading a pointer', async () => {
  const f = fixture()
  vi.mocked(f.client.core.getChainIdentifier).mockResolvedValueOnce({ chainIdentifier: toBase58(new Uint8Array(32).fill(9)) })
  await expect(f.readBySoul()).rejects.toThrow('SOUL_PUBLIC_WRONG_CHAIN')
  expect(f.get).not.toHaveBeenCalled()
})

it('aborts an uncooperative pointer request without subsequently reading its State', async () => {
  const f = fixture(), controller = new AbortController()
  let release!: () => void
  f.get.mockImplementationOnce(() => new Promise(resolve => {
    release = () => resolve({ response: { object: structuredClone(f.rows.get(f.pointerId)) } } as any)
  }))
  const reading = f.readBySoul(controller.signal)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  controller.abort(new Error('cancel pointer'))
  await expect(reading).rejects.toThrow('cancel pointer')
  release(); await Promise.resolve(); await Promise.resolve()
  expect(f.get).toHaveBeenCalledTimes(1)
})

it('uses one total bounded timeout including pointer lookup', async () => {
  const timeout = new AbortController()
  const timer = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
  try {
    const f = fixture()
    f.get.mockImplementationOnce(() => new Promise(() => {}))
    const reading = f.readBySoul()
    await vi.waitFor(() => expect(f.get).toHaveBeenCalledTimes(1))
    timeout.abort(new DOMException('read timed out', 'TimeoutError'))
    await expect(reading).rejects.toThrow('read timed out')
    expect(timer).toHaveBeenCalledExactlyOnceWith(20000)
    expect(f.get).toHaveBeenCalledTimes(1)
  } finally { timer.mockRestore() }
})
