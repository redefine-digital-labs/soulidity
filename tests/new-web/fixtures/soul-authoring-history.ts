import { vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromHex, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { SoulPublicBcs, SoulStatePublicBcs, SoulStatePointerKeyV1Bcs, SoulDetailStateBcs, SoulContentPublicBcs,
  SoulContentKeyPublicBcs, SoulContentSlotPublicBcs, SoulPublicKioskBcs, CollectionPersonalKioskCapBcs,
  KIOSK_ITEM_WRAPPER_TYPE, KioskItemWrapperBcs, SoulPublicListingBcs, CollectionKioskListingKeyBcs,
  SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, CollectionPublicListingBcs, CollectionFloorKeyBcs, CollectionFloorValueBcs } from '@soulidity/sdk'
import { soulAuthoringManifestFixture } from './soul-authoring'
import { contentAppendFixtureId as id } from './content-append-preparation'
import { activityHash } from './activity-transaction-evidence'
import { createSoulAuthoringMaterializer } from '../../../web/lib/soulidity/soul-authoring-manifest'
import { createSoulAuthoringTransactionComposer } from '../../../web/lib/soulidity/soul-authoring-transaction'
import { soulAuthoringPlan } from '../../../web/lib/soulidity/soul-authoring-runner'
import { contentEnvelopeKey } from '../../../web/lib/soulidity/content-envelope'
import { proveSoulAuthoringBusinessHistory, SoulAuthoringEventCodecs, SoulAuthoringEventsBcs, type SoulAuthoringBusinessReceipt } from '../../../web/lib/soulidity/soul-authoring-history'
import type { SoulAuthoringPacketRecord } from '../../../web/lib/soulidity/soul-authoring-packet'
import type { WalrusBatchParentHistoryContext } from '../../../web/lib/upload/walrus-batch-history'

const A = bcs.Address, U = bcs.u64(), N = bcs.u32(), S = bcs.string(), B = bcs.bool(), V = bcs.vector(bcs.u8())
const Registry = bcs.struct('KioskRegistry', { id: A, version: U })
const Lock = bcs.struct('Lock', { id: A })
const BlobKey = bcs.struct('ContentBlobKey', { kind: N, name: S, version_index: U })
const Wrapper = bcs.struct('Wrapper', { name: BlobKey })
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
function tag(type: string) { const value = TypeTagSerializer.parseFromStr(type); if (!('struct' in value)) throw Error('Expected struct'); return value.struct }

/** Real full Object BCS/effects, original independent composer and encrypted
 * materialization. The one dummy Walrus prefix and finalized ledger context are
 * caller-proved preconditions, explicitly controlled here, not network evidence. */
export async function soulAuthoringHistoryFixture(options: { kind?: 'ORDINARY' | 'IMPORTED' | 'JOINED'; list?: boolean; bind?: boolean; newKiosk?: boolean; register?: 'none' | 'collection'; sourceType?: 'gas' | 'coin' | 'staked'; createdCollection?: boolean } = {}) {
  const f = await soulAuthoringManifestFixture(r => {
    r.mints[0].kind = options.kind ?? 'ORDINARY'
    if (options.kind && options.kind !== 'ORDINARY') r.mints[0].originRef = 'original:source'
    if (options.kind === 'JOINED') r.mints[0].source = { objectId: id(730), objectType: `${id(731)}::source::Item` }
    if (options.sourceType) r.mints[0].source!.objectType = normalizeStructTag(options.sourceType === 'gas' ? '0x2::coin::Coin<0x2::sui::SUI>'
      : options.sourceType === 'coin' ? `0x2::coin::Coin<${id(731)}::fixture::TOKEN>` : '0x3::staking_pool::StakedSui')
    if (options.list) r.mints[0].listingPriceAtomic = '123'
    if (options.bind) r.bindCollectionId = id(740)
    if (options.register === 'collection' || options.createdCollection) r.collection = { name: 'Created Collection', description: 'All original metadata',
      image: r.mints[0].image, extraRoyaltyBps: 123, tradeable: true, maxSupply: '100', floorPriceAtomic: '42', listingPriceAtomic: options.list ? '123' : null }
  })
  const p = { schema: 'soulidity.soul-authoring-preparation.v1' as const, manifest: f.manifest, preparation: f.preparation }
  const r = f.request, t = r.target, pkg = t.originalPackageId, author = r.author
  const ids = { soul: id(700), state: id(701), content: r.mints[0].contentObjectId, paid: id(703), kiosk: id(704), cap: id(705), listing: id(706), source: id(730), collection: id(740) }
  const blobIds = r.mints[0].slots.map((_, i) => id(750 + i)), args = createSoulAuthoringMaterializer(f.manifest, f.preparation, blobIds)(0)
  const kiosk = options.newKiosk ? { kind: 'NEW' as const, kioskId: null, capId: null }
    : { kind: 'EXISTING' as const, kioskId: ids.kiosk, capId: ids.cap }
  const chunk = { mintIndices: [0], includePublicFiles: false, collectionObjectId: r.collection ? ids.collection : r.bindCollectionId, kiosk }
  const tx = new Transaction(); tx.moveCall({ target: `${id(900)}::fixture::walrus_checked` })
  const composer = createSoulAuthoringTransactionComposer(f.manifest, f.preparation)
  if (options.register) composer.appendRegistrationBusiness(tx, kiosk)
  else composer.prepareMintBusiness(f.preparation, blobIds, chunk).append(tx)
  const prior = toBase58(new Uint8Array(32).fill(7)), shared = { Shared: { initialSharedVersion: '12' } }, oldShared = { Shared: { initialSharedVersion: '1' } }, owned = { AddressOwner: author }
  const specs = new Map<string, { objectId: string; type: string; codec: Codec; value: any; owner: any; created: boolean }>()
  const before = new Map<string, any>(), rows = new Map<string, any>()
  function object(objectId: string, type: string, codec: Codec, value: any, owner: any, version: number, digest: string) {
    type = normalizeStructTag(type); const contents = codec.serialize(value).toBytes()
    const moveType = objectId !== ids.source || !options.sourceType ? { Other: tag(type) }
      : options.sourceType === 'gas' ? { GasCoin: true as const } : options.sourceType === 'staked' ? { StakedSui: true as const }
        : { Coin: TypeTagSerializer.parseFromStr(`${id(731)}::fixture::TOKEN`) }
    const raw = bcs.Object.serialize({ data: { Move: { type: moveType, hasPublicTransfer: false, version: String(version), contents } },
      owner, previousTransaction: digest, storageRebate: '0' }).toBytes()
    return { objectId, version: BigInt(version), objectType: type, digest: activityHash('Object', raw), previousTransaction: digest,
      owner: owner.Shared ? { kind: 3, version: BigInt(owner.Shared.initialSharedVersion) }
        : owner.AddressOwner ? { kind: 1, address: owner.AddressOwner } : { kind: 2, address: owner.ObjectOwner },
      bcs: { value: raw }, contents: { value: contents } }
  }
  function add(label: string, objectId: string, type: string, codec: Codec, value: any, owner: any, previous?: any) {
    specs.set(label, { objectId, type, codec, value, owner, created: !previous })
    if (previous) before.set(objectId, object(objectId, type, codec, previous.value, previous.owner, 11, prior))
  }
  function field(label: string, parent: string, keyType: string, keyCodec: Codec, key: any, valueType: string, codec: Codec, value: any) {
    const objectId = deriveDynamicFieldID(parent, keyType, keyCodec.serialize(key).toBytes())
    add(label, objectId, `0x2::dynamic_field::Field<${keyType},${valueType}>`, bcs.struct('Field', { id: A, name: keyCodec as any, value: codec as any }),
      { id: objectId, name: key, value }, { ObjectOwner: parent }); return objectId
  }
  function custody(label: string, assetId: string, locked: boolean) {
    const itemId = field(`${label}-item`, ids.kiosk, KIOSK_ITEM_WRAPPER_TYPE, KioskItemWrapperBcs,
      { name: { id: assetId } }, '0x2::object::ID', A, assetId)
    if (locked) field(`${label}-lock`, ids.kiosk, '0x2::kiosk::Lock', Lock, { id: assetId }, 'bool', B, true)
    return { ObjectOwner: itemId }
  }
  const added = options.kind === 'JOINED' ? 2 : 1
  const k = { id: ids.kiosk, profits: '0', owner: author, item_count: added, allow_extensions: false }
  add('kiosk', ids.kiosk, '0x2::kiosk::Kiosk', SoulPublicKioskBcs, k, options.newKiosk ? shared : oldShared,
    options.newKiosk ? undefined : { value: { ...k, item_count: 0 }, owner: oldShared })
  const cap = { id: ids.cap, cap: { id: id(707), for: ids.kiosk } }, capType = `${t.personalKioskTypePackageId}::personal_kiosk::PersonalKioskCap`
  if (options.newKiosk) add('cap', ids.cap, capType, CollectionPersonalKioskCapBcs, cap, owned)
  else before.set(ids.cap, object(ids.cap, capType, CollectionPersonalKioskCapBcs, cap, owned, 11, prior))
  const registry = { id: t.kioskRegistryId, version: '1' }
  add('registry', t.kioskRegistryId, `${pkg}::market::KioskRegistry`, Registry, registry, oldShared, { value: registry, owner: oldShared })
  if (options.newKiosk) field('registration', t.kioskRegistryId, `${pkg}::market::PersonalKioskOwnerKey`, bcs.struct('Key', { owner: A }),
    { owner: author }, `${pkg}::market::PersonalKioskRegistration`, bcs.struct('Registration', { version: U, kiosk_id: A, kiosk_cap_id: A }),
    { version: '1', kiosk_id: ids.kiosk, kiosk_cap_id: ids.cap })
  add('soul', ids.soul, `${pkg}::soul::Soul`, SoulPublicBcs, { id: ids.soul, version: '1', name: args.name, description: args.description,
    image_url: args.imageUrl, creator: author, provenance_kind: options.kind === 'JOINED' ? 2 : options.kind === 'IMPORTED' ? 1 : 0,
    origin_ref: r.mints[0].originRef }, custody('soul', ids.soul, true))
  const table = (n: number, size = 0) => ({ id: id(n), size: String(size) })
  const state = { id: ids.state, version: '1', soul_id: ids.soul, creator: author, creator_royalty_bps: r.mints[0].creatorRoyaltyBps,
    current_owner: author, current_kiosk_id: ids.kiosk, ownership_epoch: '0', grant_capacity: '1', active_grants: table(800), active_grant_ids: table(801),
    active_grant_count: '0', content_id: ids.content, config_ext: table(802, args.initialStateConfig.length + 2),
    collection_id: chunk.collectionObjectId, access_list_id: ids.paid, is_listed: Boolean(options.list) }
  add('state', ids.state, `${pkg}::soul::SoulState`, SoulStatePublicBcs, state, shared)
  field('pointer', ids.soul, `${pkg}::soul::SoulStatePointerKeyV1`, SoulStatePointerKeyV1Bcs, { version: 1 }, '0x2::object::ID', A, ids.state)
  add('paid', ids.paid, `${pkg}::paid_access::SoulPaidAccessList`, SoulDetailStateBcs.Paid,
    { id: ids.paid, version: '1', soul_id: ids.soul, creator: author, kind_configs: table(803), entries: table(804) }, shared)
  const content = { id: ids.content, version: '1', soul_id: ids.soul, items: table(805, 2), count_by_kind: table(806, 2), active: table(807) }
  add('content', ids.content, `${pkg}::content::SoulContent`, SoulContentPublicBcs, content, shared)
  const events: Array<{ name: keyof typeof SoulAuthoringEventCodecs; module: string; value: any; header?: string }> = []
  const event = (name: keyof typeof SoulAuthoringEventCodecs, module: string, value: any, header?: string) => events.push({ name, module, value, header })
  if (options.newKiosk) {
    event('NewPersonalKiosk', 'personal_kiosk', { kiosk_id: ids.kiosk }, 'personal_kiosk')
    event('PersonalKioskRegistrationUpdated', 'market', { kiosk_id: ids.kiosk, kiosk_cap_id: ids.cap, owner: author })
  }
  event('SoulContentCreated', 'content', { content_id: ids.content, soul_id: ids.soul })
  const configEvent = (key: string) => event('SoulStateConfigUpserted', 'soul', { state_id: ids.state, soul_id: ids.soul, updater: author, key })
  args.initialStateConfig.forEach((c, i) => field(`config${i}`, state.config_ext.id, '0x1::string::String', S, c.key, 'vector<u8>', V, [...new TextEncoder().encode(c.valueUtf8)]))
  ;[...args.initialStateConfig].reverse().forEach(c => configEvent(c.key))
  args.initialContent.forEach((entry, i) => {
    const e = { content_id: ids.content, soul_id: ids.soul, kind: entry.kind, kind_name: i === 0 ? 'soul_doc' : 'memory', name: entry.name,
      version_index: '0', is_public: false, download_policy: 0, grant_scope_mask: '1', read_mode_mask: '3', op_mask: i === 0 ? '0' : '1',
      seal_encrypted: true, blob_object_id: entry.blobObjectId, created_at_ms: '1000' }
    const slot = { version: '1', kind: e.kind, blob_object_id: e.blob_object_id, is_public: false, deleted: false, purged: false,
      download_policy: 0, grant_scope_mask: e.grant_scope_mask, read_mode_mask: '3', op_mask: e.op_mask, seal_encrypted: true, created_at_ms: '1000' }
    field(`slot${i}`, content.items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs, { kind: e.kind, name: e.name },
      `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs), [slot])
    field(`count${i}`, content.count_by_kind.id, 'u32', N, e.kind, 'u64', U, '1')
    const wrapper = field(`wrapper${i}`, ids.content, `0x2::dynamic_object_field::Wrapper<${pkg}::content::ContentBlobKey>`, Wrapper,
      { name: { kind: e.kind, name: e.name, version_index: '0' } }, '0x2::object::ID', A, e.blob_object_id)
    const blobCodec = bcs.struct('Blob', { id: A }), blob = { id: e.blob_object_id }
    add(`blob${i}`, e.blob_object_id, `${id(910)}::fixture::Blob`, blobCodec, blob, { ObjectOwner: wrapper }, { value: blob, owner: owned })
    const key = contentEnvelopeKey({ contentObjectId: ids.content, kind: e.kind, name: e.name, versionIndex: '0', blobObjectId: e.blob_object_id })
    field(`envelope${i}`, state.config_ext.id, '0x1::string::String', S, key, 'vector<u8>', V, [...entry.encryptedEnvelope])
    event('ContentVersionAppended', 'content', e); configEvent(key)
  })
  event('SoulPaidAccessListCreated', 'paid_access', { paid_access_list_id: ids.paid, soul_id: ids.soul, creator: author })
  const provenance = specs.get('soul')!.value.provenance_kind
  event('SoulCreated', 'soul', { soul_id: ids.soul, state_id: ids.state, content_id: ids.content, creator: author, owner: author, provenance_kind: provenance })
  event('SoulMintedToKiosk', 'market', { soul_id: ids.soul, state_id: ids.state, content_id: ids.content, kiosk_id: ids.kiosk, owner: author, provenance_kind: provenance })
  if (options.bind || options.createdCollection) {
    const collection = { id: ids.collection, version: '1', creator: author, extra_royalty_bps: 100, tradeable: true,
      current_holder: author, current_holder_kiosk_id: ids.kiosk, right_id: id(741), max_supply: '100', current_supply: '5' }
    add('collection', ids.collection, `${pkg}::collection::SoulCollection`, SoulPublicCollectionBcs, collection, oldShared,
      { value: { ...collection, current_supply: '4' }, owner: oldShared })
    event('SoulAddedToCollection', 'collection', { collection_id: ids.collection, soul_id: ids.soul, current_supply: '5', max_supply: '100' }, 'collection')
  }
  if (options.list) {
    add('listing', ids.listing, `${pkg}::market::SoulListing`, SoulPublicListingBcs, { id: ids.listing, version: '2', soul_id: ids.soul, state_id: ids.state,
      seller: author, seller_kiosk_id: ids.kiosk, price: '123', creator: author, creator_royalty_bps: r.mints[0].creatorRoyaltyBps, collection_id: chunk.collectionObjectId,
      purchase_cap: { id: id(742), kiosk_id: ids.kiosk, item_id: ids.soul, min_price: '0' }, is_active: true }, shared)
    field('listing-marker', ids.kiosk, '0x2::kiosk::Listing', CollectionKioskListingKeyBcs, { id: ids.soul, is_exclusive: true }, 'u64', U, '0')
    event('SoulListed', 'market', { listing_id: ids.listing, soul_id: ids.soul, seller: author, kiosk_id: ids.kiosk, price: '123' })
  }
  if (options.kind === 'JOINED') {
    const source = options.sourceType === 'staked' ? { id: ids.source, pool_id: id(732), stake_activation_epoch: '1', principal: '123' }
      : options.sourceType ? { id: ids.source, balance: '123' } : { id: ids.source, label: 'unchanged original NFT' }
    const codec = options.sourceType === 'staked' ? bcs.struct('StakedSui', { id: A, pool_id: A, stake_activation_epoch: U, principal: U })
      : options.sourceType ? bcs.struct('Coin', { id: A, balance: U }) : bcs.struct('Item', { id: A, label: S })
    add('source', ids.source, r.mints[0].source!.objectType, codec, source, custody('source', ids.source, false), { value: source, owner: owned })
    field('joined-marker', t.kioskRegistryId, `${pkg}::market::JoinedSourceKey`, bcs.struct('JoinedSourceKey', { source_object_id: A }),
      { source_object_id: ids.source }, 'bool', B, true)
  }
  if (options.register) {
    for (const key of specs.keys()) if (!['kiosk', 'cap', 'registry', 'registration'].includes(key)) specs.delete(key)
    events.splice(options.newKiosk ? 2 : 0)
    events.unshift({ name: 'MintManifestCommittedV1', module: 'market', value: { author, manifest_hash: fromHex(composer.manifestHash) } })
    if (options.register === 'none') { specs.clear(); events.splice(1) }
    else {
      const collection = { id: ids.collection, version: '1', creator: author, extra_royalty_bps: 123, tradeable: true,
        current_holder: author, current_holder_kiosk_id: ids.kiosk, right_id: id(741), max_supply: '100', current_supply: '0' }
      add('collection', ids.collection, `${pkg}::collection::SoulCollection`, SoulPublicCollectionBcs, collection, shared)
      add('right', id(741), `${pkg}::collection::SoulCollectionRight`, SoulPublicCollectionRightBcs,
        { id: id(741), version: '1', collection_id: ids.collection, creator: author, name: r.collection!.name,
          description: r.collection!.description, image_url: args.imageUrl }, custody('right', id(741), true))
      field('floor', ids.collection, `${pkg}::collection::FloorPolicyKeyV1`, CollectionFloorKeyBcs, { version: 1 },
        '0x1::option::Option<u128>', CollectionFloorValueBcs, '42')
      event('SoulCollectionCreated', 'collection', { collection_id: ids.collection, right_id: id(741), creator: author,
        current_holder: author, tradeable: true, max_supply: '100' })
      event('CollectionMintedToKiosk', 'market', { collection_id: ids.collection, right_id: id(741), owner: author, kiosk_id: ids.kiosk, tradeable: true })
      if (options.list) {
        add('listing', ids.listing, `${pkg}::market::CollectionListing`, CollectionPublicListingBcs, { id: ids.listing, version: '1',
          collection_id: ids.collection, right_id: id(741), seller: author, seller_kiosk_id: ids.kiosk, price: '123',
          purchase_cap: { id: id(742), kiosk_id: ids.kiosk, item_id: id(741), min_price: '0' }, is_active: true }, shared)
        field('listing-marker', ids.kiosk, '0x2::kiosk::Listing', CollectionKioskListingKeyBcs, { id: id(741), is_exclusive: true }, 'u64', U, '0')
        event('CollectionListed', 'market', { listing_id: ids.listing, collection_id: ids.collection, right_id: id(741), seller: author, kiosk_id: ids.kiosk, price: '123' })
      }
    }
  }
  const getObject = vi.fn(async ({ objectId, version }: { objectId: string; version: bigint }) => {
    const row = rows.get(`${objectId}:${version}`); if (!row) throw Error(`Missing fixture historical object ${objectId}:${version}`)
    return { response: { object: structuredClone(row) } }
  })
  function build() {
    rows.clear(); for (const row of before.values()) rows.set(`${row.objectId}:11`, row)
    const data = tx.getData()
    data.inputs = data.inputs.map(i => {
      if (!i.UnresolvedObject) return i
      const objectId = i.UnresolvedObject.objectId, row = before.get(objectId)
      return row?.owner.kind === 1 ? Inputs.ObjectRef({ objectId, version: '11', digest: row.digest })
        : Inputs.SharedObjectRef({ objectId, initialSharedVersion: '1', mutable: [t.kioskRegistryId, ids.kiosk, ids.collection].includes(objectId) })
    })
    data.sender = author; data.expiration = { $kind: 'Epoch', Epoch: '20' }
    data.gasData = { owner: author, price: '1', budget: '100000', payment: [{ objectId: id(920), version: '1', digest: prior }] }
    const bytes = TransactionDataBuilder.restore(data).build(), digest = TransactionDataBuilder.getDigestFromBytes(bytes)
    const record: SoulAuthoringPacketRecord = { schema: 'soulidity.soul-authoring-packet.v1',
      plan: soulAuthoringPlan(p, options.register ? { kind: 'REGISTER', kiosk } : { kind: 'MINT', chunk }),
      packet: { bytes: toBase64(bytes), digest, expirationEpoch: '20', phase: 'PREPARED', signature: null } }
    const changes: any[] = []
    for (const s of specs.values()) {
      const row = object(s.objectId, s.type, s.codec, s.value, s.owner, 12, digest), old = before.get(s.objectId)
      rows.set(`${s.objectId}:12`, row)
      const inputOwner = old ? bcs.Object.parse(old.bcs.value).owner : undefined
      changes.push([s.objectId, { inputState: s.created ? { NotExist: true } : { Exist: [['11', old.digest], inputOwner] },
        outputState: { ObjectWrite: [row.digest, s.owner] }, idOperation: s.created ? { Created: true } : { None: true } }])
    }
    const rawEvents = SoulAuthoringEventsBcs.serialize(events.map(e => ({ package_id: e.name === 'NewPersonalKiosk' ? t.kioskPackageId : t.callablePackageId,
      transaction_module: e.header ?? 'market', sender: author,
      type_: tag(`${e.name === 'NewPersonalKiosk' ? t.personalKioskTypePackageId : pkg}::${e.module}::${e.name}`),
      contents: (SoulAuthoringEventCodecs[e.name] as Codec).serialize(e.value).toBytes() }))).toBytes()
    const effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { status: { Success: true }, transactionDigest: digest,
      executedEpoch: '10', lamportVersion: '12', changedObjects: changes, unchangedConsensusObjects: [], gasObjectIndex: null,
      gasUsed: { computationCost: '1', storageCost: '1', storageRebate: '0', nonRefundableStorageFee: '0' },
      dependencies: [], auxDataDigest: null, eventsDigest: activityHash('TransactionEvents', rawEvents) } }).toBytes())
    const context: WalrusBatchParentHistoryContext = { stage: options.register ? 'register' : 'consume', preparation: f.preparation, packet: { bytes: record.packet.bytes, digest }, effects, events: rawEvents,
      checkpoint: '100', walrusCommandIndices: [0], walrusEventIndices: [], indices: [0, 1],
      blobs: blobIds.map((objectId, index) => {
        const file = f.preparation.manifest.files[index]
        return { index, objectId, version: '11', digest: before.get(objectId)!.digest, blobId: file.encoding.blobId,
          rootHash: file.encoding.rootHash, size: String(file.payloadByteLength), recipient: file.recipient, encodingType: 1,
          registeredEpoch: 10, storageStartEpoch: 10, storageEndEpoch: 10 + r.storageEpochs }
      }) }
    const registrationReceipt: SoulAuthoringBusinessReceipt | null = options.createdCollection ? {
      parentKey: record.plan.parentKey, manifestHash: record.plan.manifestHash, transactionDigest: prior, checkpoint: '99', stage: 'REGISTER',
      kiosk: { kioskId: ids.kiosk, capId: ids.cap }, collection: { collectionId: ids.collection, rightId: id(741), listingId: null }, mints: [],
    } : null
    return { client: { ledgerService: { getObject } } as any, preparation: p, record, context, registrationReceipt, signal: f.controller.signal }
  }
  return { ...f, ids, specs, events, rows, getObject, build, prove: () => proveSoulAuthoringBusinessHistory(build()) }
}
