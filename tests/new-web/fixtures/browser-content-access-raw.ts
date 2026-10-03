import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, toBase58, fromBase64, toBase64 } from '@mysten/sui/utils'
import { WalrusClient } from '../../../web/node_modules/@mysten/walrus/dist/index.mjs'
import { EncryptedObject } from '../../../web/node_modules/@mysten/seal/dist/index.mjs'
import { SoulDetailStateBcs as D, SoulStatePublicBcs, SoulPublicBcs, SoulContentPublicBcs, SoulContentKeyPublicBcs,
  SoulContentSlotPublicBcs, SoulStatePointerKeyV1Bcs, ProfileWalrusBlobBcs, buildSoulPublicPreviewStateConfig,
  generateContentDocumentIdHex } from '@soulidity/sdk'
import { browserArtworkFixture } from './browser-native-artwork'
import { fixtureKioskItem } from './native-receive'
import { contentEnvelopeFixture } from './content-envelope'
import { contentEnvelopeKey, encodeContentEnvelope } from '../../../web/lib/soulidity/content-envelope'
import { readBrowserContentAccess } from '../../../web/lib/soulidity/browser-content-access'
const id = (n: number) => `0x${(n + 1000).toString(16).padStart(64, '0')}`, digest = toBase58(new Uint8Array(32).fill(1))
const CLOCK = `0x${'0'.repeat(63)}6`
const A = bcs.Address, N = bcs.u32(), U = bcs.u64(), S = bcs.string(), V = bcs.vector(bcs.u8())
// Typed table fixture adapted from the existing soul-detail-state raw suite.
// Real proof readers run; only transport and the real Walrus SDK's fresh epoch I/O are stubbed.
export function browserContentAccessFixture() {
  const base = browserArtworkFixture()
  const deployment = { originalPackageId: base.target.soulidityOriginalPackageId, chainIdentifier: '35834a8a', kindRegistryId: id(30) }, pkg = deployment.originalPackageId
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
  const rows = base.objects, tables = new Map<string, any[]>()
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
  put(soul.id, `${pkg}::soul::Soul`, SoulPublicBcs.serialize(soul).toBytes(), { kind: 2, address: state.current_kiosk_id })
  fixtureKioskItem(rows, state.current_kiosk_id, soul.id)
  const putClock = (timestamp = '1000') => put(CLOCK, '0x2::clock::Clock', D.Clock.serialize({ id: CLOCK, timestamp_ms: timestamp }).toBytes()); putClock()
  const configId = field(state.config_ext.id, '0x1::string::String', S, 'sprite_config_json', 'vector<u8>', V, [...new TextEncoder().encode('{"frames":2}')])
  const countId = field(content.count_by_kind.id, 'u32', N, 3, 'u64', U, '1')
  const reverseKindId = field(registry.name_to_kind.id, '0x1::string::String', S, 'sprite', 'u32', N, 3)
  const reverseGrantId = field(state.active_grant_ids.id, '0x2::object::ID', A, grant.id, 'address', A, grant.grantee)
  field(paid.entries.id, 'address', A, id(51), `0x2::table::Table<u32,${pkg}::paid_access::KindPaidEntry>`, D.Table, { id: id(62), size: '1' })
  field(paid.entries.id, 'address', A, id(52), `0x2::table::Table<u32,${pkg}::paid_access::KindPaidEntry>`, D.Table, { id: id(63), size: '1' })
  putEntry(); putEntry(id(63))
  const client = base.client
  const batch = base.batch.mockImplementation(((args: any) => Promise.resolve({ response: {
    objects: args.requests.map((r: any) => ({ result: rows.has(r.objectId) ? { oneofKind: 'object', object: structuredClone(rows.get(r.objectId)) }
      : { oneofKind: 'error', error: { code: 5 } } })) } })) as any)
  const list = vi.spyOn(client.stateService, 'listDynamicFields').mockImplementation(((args: any) => Promise.resolve({ response: {
    dynamicFields: structuredClone(tables.get(args.parent) ?? []) } })) as any)

  const pointerKey = `${pkg}::soul::SoulStatePointerKeyV1`
  const pointerId = field(soul.id, pointerKey, SoulStatePointerKeyV1Bcs, { version: 1 }, '0x2::object::ID', A, state.id)
  const preview = buildSoulPublicPreviewStateConfig({ tags: [], previewImages: [] })
  field(state.config_ext.id, '0x1::string::String', S, preview.key, 'vector<u8>', V, [...new TextEncoder().encode(preview.valueUtf8)])
  content.items.size = '2'; content.count_by_kind.size = '2'; putContent()
  field(content.items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs, { kind: 0, name: 'soul' },
    `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs),
    [{ ...slot, kind: 0, blob_object_id: id(101), read_mode_mask: '3', op_mask: '0', grant_scope_mask: '1', download_policy: 0, created_at_ms: '1' }])
  field(content.count_by_kind.id, 'u32', N, 0, 'u64', U, '1')
  field(registry.kinds.id, 'u32', N, 0, `${pkg}::kind_registry::KindDescriptor`, D.Descriptor,
    { ...descriptor, kind: 0, name: 'soul_doc', op_mask: '0', read_mode_mask: '3', has_active_binding: false, requires_download_policy: false, default_grant_scope_mask: '1' })
  field(registry.name_to_kind.id, '0x1::string::String', S, 'soul_doc', 'u32', N, 0)
  const envelope = contentEnvelopeFixture(3, 'main')
  envelope.contentObjectId = content.id; envelope.blobObjectId = slots[0].blob_object_id
  envelope.sidecar.documentId = generateContentDocumentIdHex({ contentObjectId: content.id, kind: 3, name: 'main', versionIndex: 0, nonce: new Uint8Array(16).fill(7) })
  const encrypted = EncryptedObject.parse(fromBase64(envelope.sidecar.encryptedDek)); encrypted.id = envelope.sidecar.documentId
  envelope.sidecar.encryptedDek = toBase64(EncryptedObject.serialize(encrypted).toBytes())
  const putEnvelope = () => field(state.config_ext.id, '0x1::string::String', S, contentEnvelopeKey(envelope), 'vector<u8>', V,
    [...new TextEncoder().encode(encodeContentEnvelope(envelope, pkg))])
  const envelopeFieldId = putEnvelope(); state.config_ext.size = '3'; putState()
  const blobKey = { name: { kind: 3, name: 'main', version_index: '0' } }
  const BlobKey = bcs.struct('ContentBlobKey', { kind: N, name: S, version_index: U })
  const Wrapper = bcs.struct('Wrapper', { name: BlobKey })
  const blobFieldId = field(content.id, `0x2::dynamic_object_field::Wrapper<${pkg}::content::ContentBlobKey>`, Wrapper, blobKey, '0x2::object::ID', A, slots[0].blob_object_id)
  const storage = { blobType: `${id(990)}::blob::Blob`, aggregatorUrl: 'https://walrus.example.com' }
  const blob = { id: slots[0].blob_object_id, registered_epoch: 1, blob_id: bcs.u256().parse(new Uint8Array(32).fill(7)), size: '64',
    encoding_type: 1, certified_epoch: 2 as number | null, storage: { id: id(991), start_epoch: 1, end_epoch: 10, storage_size: '9999' }, deletable: true }
  const putBlob = () => put(blob.id, storage.blobType, ProfileWalrusBlobBcs.serialize(blob).toBytes(), { kind: 2, address: blobFieldId })
  putBlob()
  const reset = vi.spyOn(WalrusClient.prototype, 'reset')
  vi.spyOn(WalrusClient.prototype, 'getBlobType').mockReturnValue(storage.blobType)
  const system = vi.spyOn(WalrusClient.prototype, 'systemState').mockResolvedValue({ committee: { epoch: 3 } } as any)
  const config = { target: base.target, kindRegistryId: registry.id, storage }
  const params = { soulId: soul.id, stateId: state.id, contentId: content.id, kind: 3, name: 'main', versionIndex: '0',
    viewerAddress: state.current_owner as string | null, config }
  const read = (extra = {}) => readBrowserContentAccess({ ...params, ...extra }, { client: () => client })
  return { ...base, client, deployment, state, soul, content, registry, descriptor, slots, active, grantSlot, grant, paid, paidConfig, entry,
    rows, tables, field, batch, list, read, putState, putContent, putRegistry, putPaid, putSlots, putActive, putDescriptor,
    putGrantSlot, putGrant, putPaidConfig, putEntry, configId, countId, reverseKindId, reverseGrantId,
    pointerId, envelope, putEnvelope, envelopeFieldId, blob, putBlob, blobFieldId, config, params, reset, system, putClock }
}
