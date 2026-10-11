import { afterEach, expect, it, vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { SoulContentPublicBcs, SoulContentKeyPublicBcs, SoulContentSlotPublicBcs, SoulDetailStateBcs, downloadPolicyToU8 } from '@soulidity/sdk'
import { activityHash } from './fixtures/activity-transaction-evidence'
import { soulAuthoringManifestFixture } from './fixtures/soul-authoring'
import { contentAppendFixtureId as id } from './fixtures/content-append-preparation'
import { createSoulAuthoringMaterializer } from '../../web/lib/soulidity/soul-authoring-manifest'
import { soulAuthoringPlan } from '../../web/lib/soulidity/soul-authoring-runner'
import { createSoulAuthoringHistoricalReader } from '../../web/lib/soulidity/soul-authoring-history-read'
import { proveSoulAuthoringContent, type SoulAuthoringContentEvent } from '../../web/lib/soulidity/soul-authoring-content-history'
import { contentEnvelopeKey } from '../../web/lib/soulidity/content-envelope'
import type { SoulAuthoringPacketRecord } from '../../web/lib/soulidity/soul-authoring-packet'

afterEach(() => vi.restoreAllMocks())
const A = bcs.Address, S = bcs.string(), U = bcs.u64(), N = bcs.u32(), V = bcs.vector(bcs.u8())
const BlobKey = bcs.struct('ContentBlobKey', { kind: N, name: S, version_index: U })
const Wrapper = bcs.struct('Wrapper', { name: BlobKey })
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
function structTag(type: string) {
  const tag = TypeTagSerializer.parseFromStr(type)
  if (!('struct' in tag)) throw Error('Fixture requires Move struct')
  return tag.struct
}

// Full Object BCS/digests and effects, with real encrypted materialization.
// Finality and Move execution are controlled prerequisites, not wallet/chain evidence.
async function fixture() {
  const f = await soulAuthoringManifestFixture(r => {
    const slots = r.mints[0].slots
    slots.push({ ...slots[1], fileIndex: 2, versionIndex: '1' })
    slots.push({ ...slots[0], fileIndex: 3, kind: 3, name: 'picture', setActive: true })
    slots.push({ ...slots[3], fileIndex: 4, name: 'second-picture' })
    r.mints[0].stateConfig = [{ key: 'sprite_config_json', valueUtf8: '{"frames":1}' }]
  })
  const pkg = f.request.target.originalPackageId, soulId = id(700), contentId = f.request.mints[0].contentObjectId
  const blobIds = f.preparation.manifest.files.map((_, i) => id(800 + i))
  const mint = createSoulAuthoringMaterializer(f.manifest, f.preparation, blobIds)(0)
  const preparation = { schema: 'soulidity.soul-authoring-preparation.v1' as const, manifest: f.manifest, preparation: f.preparation }
  const prior = toBase58(new Uint8Array(32).fill(7)), tx = new Transaction()
  tx.setSender(f.request.author); tx.setGasOwner(f.request.author); tx.setGasBudget(100000); tx.setGasPrice(1)
  tx.setGasPayment([{ objectId: id(901), version: '1', digest: prior }]); tx.setExpiration({ Epoch: 10 })
  const bytes = await tx.build(), digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  const record: SoulAuthoringPacketRecord = { schema: 'soulidity.soul-authoring-packet.v1',
    plan: soulAuthoringPlan(preparation, { kind: 'MINT', chunk: { mintIndices: [0], includePublicFiles: false,
      collectionObjectId: null, kiosk: { kind: 'EXISTING', kioskId: id(710), capId: id(711) } } }),
    packet: { bytes: toBase64(bytes), digest, expirationEpoch: '10', phase: 'PREPARED', signature: null } }
  const specs = new Map<string, { objectId: string; type: string; codec: Codec; value: any; owner: any; created: boolean }>()
  function add(label: string, objectId: string, type: string, codec: Codec, value: any, owner: any, created = true) {
    specs.set(label, { objectId, type: normalizeStructTag(type), codec, value, owner, created }); return objectId
  }
  function field(label: string, parent: string, keyType: string, keyCodec: Codec, key: any, valueType: string, codec: Codec, value: any) {
    const objectId = deriveDynamicFieldID(parent, keyType, keyCodec.serialize(key).toBytes())
    return add(label, objectId, `0x2::dynamic_field::Field<${keyType},${valueType}>`,
      bcs.struct('Field', { id: A, name: keyCodec as any, value: codec as any }), { id: objectId, name: key, value }, { ObjectOwner: parent })
  }
  const content = { id: contentId, version: '1', soul_id: soulId, items: { id: id(720), size: '4' },
    count_by_kind: { id: id(721), size: '3' }, active: { id: id(722), size: '1' } }
  const config = { id: id(723), size: String(mint.initialStateConfig.length + mint.initialContent.length) }
  add('content', contentId, `${pkg}::content::SoulContent`, SoulContentPublicBcs, content, { Shared: { initialSharedVersion: '12' } })
  const events: SoulAuthoringContentEvent[] = mint.initialContent.map(e => ({ content_id: contentId, soul_id: soulId,
    kind: e.kind, kind_name: `kind-${e.kind}`, name: e.name, version_index: String(e.expectedVersionIndex),
    is_public: Boolean(e.slotReadModeMask & 8), download_policy: downloadPolicyToU8(e.downloadPolicy),
    grant_scope_mask: '1', read_mode_mask: String(e.slotReadModeMask), op_mask: '1', seal_encrypted: true,
    blob_object_id: e.blobObjectId, created_at_ms: '1000' }))
  const groups = new Map<string, any[]>()
  mint.initialContent.forEach((entry, i) => {
    const e = events[i], key = `${e.kind}:${e.name}`, slots = groups.get(key) ?? []
    slots.push({ version: '1', kind: e.kind, blob_object_id: e.blob_object_id, is_public: e.is_public,
      download_policy: e.download_policy, grant_scope_mask: e.grant_scope_mask, read_mode_mask: e.read_mode_mask,
      op_mask: e.op_mask, seal_encrypted: true, deleted: false, purged: false, created_at_ms: e.created_at_ms }); groups.set(key, slots)
    const wrapperId = field(`wrapper${i}`, contentId, `0x2::dynamic_object_field::Wrapper<${pkg}::content::ContentBlobKey>`, Wrapper,
      { name: { kind: e.kind, name: e.name, version_index: e.version_index } }, '0x2::object::ID', A, e.blob_object_id)
    add(`blob${i}`, e.blob_object_id, `${id(50)}::fixture::Blob`, bcs.struct('Blob', { id: A }),
      { id: e.blob_object_id }, { ObjectOwner: wrapperId }, false)
    field(`envelope${i}`, config.id, '0x1::string::String', S, contentEnvelopeKey({ contentObjectId: contentId,
      kind: e.kind, name: e.name, versionIndex: e.version_index, blobObjectId: e.blob_object_id }), 'vector<u8>', V, [...entry.encryptedEnvelope])
  })
  for (const [key, slots] of groups) field(`slots-${key}`, content.items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs,
    { kind: slots[0].kind, name: key.slice(key.indexOf(':') + 1) }, `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs), slots)
  for (const [kind, count] of [[0, 1], [1, 1], [3, 2]]) field(`count${kind}`, content.count_by_kind.id, 'u32', N, kind, 'u64', U, String(count))
  field('active', content.active.id, 'u32', N, 3, `${pkg}::content::ActiveBinding`, SoulDetailStateBcs.Active,
    { version: '1', kind: 3, name: 'second-picture', version_index: '0', download_policy: 0 })
  mint.initialStateConfig.forEach((c, i) => field(`config${i}`, config.id, '0x1::string::String', S, c.key,
    'vector<u8>', V, [...new TextEncoder().encode(c.valueUtf8)]))
  const rows = new Map<string, any>(), controller = new AbortController()
  const getObject = vi.fn(async ({ objectId, version }: { objectId: string; version: bigint }) => {
    if (version !== 12n) throw Error('Unexpected historical version')
    return { response: { object: structuredClone(rows.get(objectId)) } }
  })
  function build() {
    rows.clear(); const changes: any[] = []
    for (const s of specs.values()) {
      const contents = s.codec.serialize(s.value).toBytes()
      const raw = bcs.Object.serialize({ data: { Move: { type: { Other: structTag(s.type) },
        hasPublicTransfer: false, version: '12', contents } }, owner: s.owner, previousTransaction: digest, storageRebate: '0' }).toBytes()
      const objectDigest = activityHash('Object', raw)
      rows.set(s.objectId, { objectId: s.objectId, version: 12n, objectType: s.type, digest: objectDigest, previousTransaction: digest,
        owner: s.owner.Shared ? { kind: 3, version: BigInt(s.owner.Shared.initialSharedVersion) } : { kind: 2, address: s.owner.ObjectOwner },
        bcs: { value: raw }, contents: { value: contents } })
      changes.push([s.objectId, { inputState: s.created ? { NotExist: true } : { Exist: [['11', prior], { AddressOwner: f.request.author }] },
        outputState: { ObjectWrite: [objectDigest, s.owner] }, idOperation: s.created ? { Created: true } : { None: true } }])
    }
    const effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { transactionDigest: digest,
      status: { Success: true }, executedEpoch: '9', lamportVersion: '12', changedObjects: changes, unchangedConsensusObjects: [],
      gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' }, gasObjectIndex: null,
      eventsDigest: null, dependencies: [], auxDataDigest: null } }).toBytes())
    const reader = createSoulAuthoringHistoricalReader({ client: { ledgerService: { getObject } } as any, record, effects, signal: controller.signal })
    return { reader, effects }
  }
  const params = { originalPackageId: pkg, soulId, contentId, stateConfigTable: config,
    initialContent: mint.initialContent, initialStateConfig: mint.initialStateConfig, events }
  const prove = () => proveSoulAuthoringContent({ ...params, reader: build().reader })
  return { specs, params, prove, build, rows, getObject, controller, record }
}

it('proves all encrypted versions, distinct-name counts, last active binding and exact envelopes', async () => {
  const f = await fixture(); expect((await f.prove()).items.size).toBe('4')
  expect(f.getObject).toHaveBeenCalled(); expect(f.getObject.mock.calls.every(([q]) => q.version === 12n)).toBe(true)
})
it.each([
  ['wrong Soul', 'content', (s: any) => { s.value.soul_id = id(999) }, 'INITIAL_CONTENT_ROOT'],
  ['wrong shared birth', 'content', (s: any) => { s.owner.Shared.initialSharedVersion = '11' }, 'INITIAL_CONTENT_ROOT'],
  ['extra slot', 'slots-1:default', (s: any) => { s.value.value.push(s.value.value[0]) }, 'INITIAL_SLOT_COUNT'],
  ['wrong second version', 'slots-1:default', (s: any) => { s.value.value[1].blob_object_id = id(999) }, 'INITIAL_SLOT_MISMATCH'],
  ['plaintext slot', 'slots-0:soul', (s: any) => { s.value.value[0].seal_encrypted = false }, 'INITIAL_SLOT_MISMATCH'],
  ['wrong count', 'count1', (s: any) => { s.value.value = '2' }, 'INITIAL_KIND_COUNT'],
  ['first active instead of last', 'active', (s: any) => { s.value.value.name = 'picture' }, 'INITIAL_ACTIVE_MISMATCH'],
  ['wrong envelope', 'envelope2', (s: any) => { s.value.value[0] ^= 1 }, 'INITIAL_CONFIG_OR_ENVELOPE_MISMATCH'],
  ['wrong public config', 'config0', (s: any) => { s.value.value = [123, 125] }, 'INITIAL_CONFIG_OR_ENVELOPE_MISMATCH'],
  ['wrong wrapper Blob', 'wrapper2', (s: any) => { s.value.value = id(999) }, 'INITIAL_BLOB_CONTAINMENT'],
  ['wrong Blob custody', 'blob2', (s: any) => { s.owner.ObjectOwner = id(999) }, 'INITIAL_BLOB_CONTAINMENT'],
  ['wrong field parent', 'envelope1', (s: any) => { s.owner.ObjectOwner = id(999) }, 'HISTORY_FIELD_IDENTITY'],
  ['wrong field name', 'envelope1', (s: any) => { s.value.name = 'wrong' }, 'HISTORY_FIELD_IDENTITY'],
  ['mutated initial field', 'envelope1', (s: any) => { s.created = false }, 'LIFETIME_MISMATCH'],
  ['created Blob', 'blob0', (s: any) => { s.created = true }, 'LIFETIME_MISMATCH'],
] as const)('rejects fully rehashed %s', async (_label, key, mutate, error) => {
  const f = await fixture(); mutate(f.specs.get(key)); await expect(f.prove()).rejects.toThrow(error)
})
it.each(['missing', 'reordered', 'wrong-Blob', 'extra'] as const)('rejects %s initial version events', async mode => {
  const f = await fixture(), events = f.params.events
  if (mode === 'missing') events.pop()
  if (mode === 'extra') events.push(structuredClone(events[0]))
  if (mode === 'reordered') [events[1], events[2]] = [events[2], events[1]]
  if (mode === 'wrong-Blob') events[2].blob_object_id = id(999)
  await expect(f.prove()).rejects.toThrow(/INITIAL_CONTENT_EVENT/)
})
it('rejects uncommitted Object bytes and preserves cancellation or missing history as failures', async () => {
  const f = await fixture(), { reader } = f.build()
  const row = f.rows.get(f.params.contentId), object = bcs.Object.parse(row.bcs.value)
  object.storageRebate = '99'; row.bcs.value = bcs.Object.serialize(object).toBytes()
  await expect(proveSoulAuthoringContent({ ...f.params, reader })).rejects.toThrow('BCS_DIGEST_MISMATCH')
  f.getObject.mockRejectedValueOnce(Error('Historical RPC unavailable'))
  await expect(f.prove()).rejects.toThrow('Historical RPC unavailable')
  f.controller.abort(Error('history-cancelled')); await expect(f.prove()).rejects.toThrow('history-cancelled')
})

async function inputFixture(shared: boolean, mutated = true) {
  const f = await fixture(), { effects } = f.build(), objectId = id(990), type = `${id(50)}::fixture::Input`
  const codec = bcs.struct('Input', { id: A, value: U }), value = { id: objectId, value: '17' }
  const owner = shared ? { Shared: { initialSharedVersion: '1' } } : { AddressOwner: id(991) }
  const bytes = bcs.Object.serialize({ data: { Move: { type: { Other: structTag(type) },
    hasPublicTransfer: false, version: '11', contents: codec.serialize(value).toBytes() } }, owner,
    previousTransaction: toBase58(new Uint8Array(32).fill(7)), storageRebate: '0' }).toBytes()
  const digest = activityHash('Object', bytes), data = Transaction.from(f.record.packet.bytes).getData()
  data.inputs = [shared ? Inputs.SharedObjectRef({ objectId, initialSharedVersion: '1', mutable: true })
    : Inputs.ObjectRef({ objectId, version: '11', digest })]
  const packetBytes = TransactionDataBuilder.restore(data).build()
  const record = { ...f.record, packet: { ...f.record.packet, bytes: toBase64(packetBytes), digest: TransactionDataBuilder.getDigestFromBytes(packetBytes) } }
  effects.V2!.transactionDigest = record.packet.digest
  effects.V2!.changedObjects = mutated ? [[objectId, bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: {
    ...effects.V2!, changedObjects: [[objectId, { inputState: { Exist: [['11', digest], owner] },
      outputState: { ObjectWrite: [digest, owner] }, idOperation: { None: true } }]],
  } }).toBytes()).V2!.changedObjects[0][1]]] : []
  const row = { objectId, version: 11n, digest, bcs: { value: bytes } }
  const getObject = vi.fn(async (_request: { objectId: string; version: bigint }) => ({ response: { object: structuredClone(row) } }))
  const read = () => createSoulAuthoringHistoricalReader({ client: { ledgerService: { getObject } } as any,
    record, effects, signal: new AbortController().signal }).input(objectId, type, codec)
  return { record, row, effects, getObject, read, objectId, value }
}
it.each([[false, false], [false, true], [true, true]])('reads frozen input shared=%s mutated=%s at exact authenticated version', async (shared, mutated) => {
  const f = await inputFixture(shared, mutated)
  expect((await f.read()).value).toEqual(f.value)
  expect(f.getObject.mock.calls[0][0]).toMatchObject({ objectId: f.objectId, version: 11n })
})
it.each(['digest', 'owner', 'version', 'shared-birth', 'immutable-shared', 'uncommitted-bytes'] as const)
  ('rejects frozen input %s mismatch', async mode => {
    const shared = mode === 'shared-birth' || mode === 'immutable-shared', f = await inputFixture(shared)
    const input = f.effects.V2!.changedObjects[0][1].inputState.Exist!
    if (mode === 'digest') f.row.digest = toBase58(new Uint8Array(32).fill(9))
    if (mode === 'owner') input[1] = bcs.Owner.parse(bcs.Owner.serialize({ AddressOwner: id(999) }).toBytes())
    if (mode === 'version') input[0][0] = '10'
    if (mode === 'shared-birth') input[1].Shared!.initialSharedVersion = '2'
    if (mode === 'uncommitted-bytes') {
      const raw = bcs.Object.parse(f.row.bcs.value); raw.storageRebate = '99'; f.row.bcs.value = bcs.Object.serialize(raw).toBytes()
    }
    if (mode === 'immutable-shared') {
      const data = Transaction.from(f.record.packet.bytes).getData(); data.inputs[0].Object!.SharedObject!.mutable = false
      const bytes = TransactionDataBuilder.restore(data).build()
      f.record.packet.bytes = toBase64(bytes); f.record.packet.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
      f.effects.V2!.transactionDigest = f.record.packet.digest
    }
    await expect(f.read()).rejects.toThrow()
  })
