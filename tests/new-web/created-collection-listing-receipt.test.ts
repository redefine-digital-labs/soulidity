// Canonical SDK transaction/ledger/object fixtures; not Move execution or wallet acceptance.
import { afterEach, expect, it, vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Inputs, TransactionDataBuilder } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { buildCreateCollectionWithListTx, SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicKioskBcs,
  CollectionPublicListingBcs, CollectionKioskListingKeyBcs, CollectionKioskListingFieldBcs,
  deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '@soulidity/sdk'
import { readCreatedCollectionListingReceipt } from '../../web/lib/collections/created-collection-listing-receipt'
import { activityEvidenceFixture, aid as id, adigest, activityHash } from './fixtures/activity-transaction-evidence'

const A = bcs.Address
const Minted = bcs.struct('Minted', { collection_id: A, right_id: A, owner: A, kiosk_id: A, tradeable: bcs.bool() })
const Listed = bcs.struct('Listed', { listing_id: A, collection_id: A, right_id: A, seller: A, kiosk_id: A, price: bcs.u64() })
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
async function fixture() {
  const f = await activityEvidenceFixture(), pkg = f.deployment.originalPackageId, author = f.sender, version = f.effectsData.V2!.lamportVersion
  vi.stubEnv('NEXT_PUBLIC_KIOSK_PACKAGE_ID', id(83))
  for (const [key, value] of Object.entries({ CALLABLE_PACKAGE_ID: f.deployment.callablePackageId,
    MARKET_CONFIG_V2_ID: id(80), KIOSK_REGISTRY_ID: id(81), COLLECTION_TRANSFER_POLICY_ID: id(82) }))
    vi.stubEnv('NEXT_PUBLIC_SOULIDITY_' + key, value)
  const collection = { id: id(100), version: '1', creator: author, extra_royalty_bps: 123, tradeable: true,
    current_holder: author, current_holder_kiosk_id: id(102), right_id: id(101), max_supply: null, current_supply: '0' }
  const right = { id: id(101), version: '1', collection_id: id(100), creator: author, name: 'Bundled launch',
    description: 'Collection rights', image_url: 'https://example.com/image.png' }
  const kiosk = { id: id(102), profits: '0', owner: author, item_count: 1, allow_extensions: false }
  const listing = { id: id(103), version: '1', collection_id: id(100), right_id: id(101), seller: author,
    seller_kiosk_id: id(102), price: '9007199254740993', purchase_cap: { id: id(104), kiosk_id: id(102), item_id: id(101), min_price: '0' }, is_active: true }
  const tx = await buildCreateCollectionWithListTx({ currentKioskId: kiosk.id, currentKioskCapOnChainId: id(105),
    name: right.name, description: right.description, imageUrl: right.image_url, extraRoyaltyBps: 123, tradeable: true,
    collectionRightListingPriceAtomic: BigInt(listing.price) })
  tx.setSender(author); tx.setGasOwner(author); tx.setGasPrice('1'); tx.setGasBudget('1000')
  tx.setGasPayment([{ objectId: id(8), version: '2', digest: adigest(8) }])
  const builder = new TransactionDataBuilder(tx.getData())
  builder.inputs = builder.inputs.map(input => input.UnresolvedObject
    ? input.UnresolvedObject.objectId === id(105) ? Inputs.ObjectRef({ objectId: id(105), version: '2', digest: adigest(105) })
      : Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1', mutable: input.UnresolvedObject.objectId === kiosk.id || input.UnresolvedObject.objectId === id(81) })
    : input)
  f.transactionData.V1 = bcs.TransactionData.parse(builder.build()).V1; f.rehashTransaction()
  const digest = f.params().transactionDigest, itemId = deriveKioskItemFieldId(kiosk.id, right.id)
  const markerId = deriveDynamicFieldID(kiosk.id, '0x2::kiosk::Listing', CollectionKioskListingKeyBcs.serialize({ id: right.id, is_exclusive: true }).toBytes())
  const rows = new Map<string, any>(), definitions = new Map<string, { type: string; codec: Codec; value: any; owner: any; created: boolean }>()
  function put(objectId: string, type: string, codec: Codec, value: any, owner: any, created = true) {
    const contents = codec.serialize(value).toBytes()
    const tag = TypeTagSerializer.parseFromStr(type)
    if (!('struct' in tag)) throw new Error('Fixture requires a Move struct')
    const full = bcs.Object.parse(bcs.Object.serialize({ data: { Move: { type: { Other: tag.struct },
      hasPublicTransfer: true, version, contents } }, owner, previousTransaction: digest, storageRebate: '0' }).toBytes())
    const raw = bcs.Object.serialize(full).toBytes(), hash = activityHash('Object', raw)
    const row = { objectId, objectType: normalizeStructTag(type), version: BigInt(version), digest: hash, previousTransaction: digest,
      contents: { value: contents }, bcs: { value: raw }, owner: full.owner.Shared ? { kind: 3, version: BigInt(full.owner.Shared.initialSharedVersion) }
        : full.owner.ObjectOwner ? { kind: 2, address: full.owner.ObjectOwner } : { kind: 1, address: full.owner.AddressOwner } }
    rows.set(objectId, row); definitions.set(objectId, { type, codec, value, owner, created })
    const change = { inputState: created ? { $kind: 'NotExist', NotExist: true } : { $kind: 'Exist', Exist: [['2', adigest(2)], full.owner] },
      outputState: { $kind: 'ObjectWrite', ObjectWrite: [hash, full.owner] }, idOperation: created ? { $kind: 'Created', Created: true } : { $kind: 'None', None: true } } as any
    const changes = f.effectsData.V2!.changedObjects, existing = changes.findIndex(([n]) => n === objectId)
    if (existing >= 0) changes[existing][1] = change; else changes.push([objectId, change])
  }
  const shared = { Shared: { initialSharedVersion: version } }
  put(collection.id, pkg + '::collection::SoulCollection', SoulPublicCollectionBcs, collection, shared)
  put(right.id, pkg + '::collection::SoulCollectionRight', SoulPublicCollectionRightBcs, right, { ObjectOwner: itemId })
  put(kiosk.id, '0x2::kiosk::Kiosk', SoulPublicKioskBcs, kiosk, { Shared: { initialSharedVersion: '1' } }, false)
  put(itemId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs, { id: itemId, name: { name: { id: right.id } }, value: right.id }, { ObjectOwner: kiosk.id })
  put(listing.id, pkg + '::market::CollectionListing', CollectionPublicListingBcs, listing, shared)
  put(markerId, '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>', CollectionKioskListingFieldBcs,
    { id: markerId, name: { id: right.id, is_exclusive: true }, value: '0' }, { ObjectOwner: kiosk.id })
  const minted = { collection_id: collection.id, right_id: right.id, owner: author, kiosk_id: kiosk.id, tradeable: true }
  const listed = { listing_id: listing.id, collection_id: collection.id, right_id: right.id, seller: author, kiosk_id: kiosk.id, price: listing.price }
  const event = (name: string, contents: Uint8Array) => ({ package_id: f.deployment.callablePackageId, transaction_module: 'market', sender: author,
    type_: { address: pkg, module: 'market', name, typeParams: [] }, contents })
  // Unrelated Walrus events/objects coexist with this creation and are not a
  // reason to substitute a stricter standalone-list packet grammar.
  f.eventsData.data = [f.eventsData.data[3], event('CollectionMintedToKiosk', Minted.serialize(minted).toBytes()), event('CollectionListed', Listed.serialize(listed).toBytes())]
  f.packageData.data.Package!.typeOriginTable.push(...['CollectionMintedToKiosk', 'CollectionListed'].map(datatypeName => ({ moduleName: 'market', datatypeName, package: pkg })))
  f.rehashPackage(); f.rehashEvents()
  f.client.ledgerService.getObject.mockImplementation(async (...args: unknown[]) => {
    const request = args[0] as { objectId: string; version?: bigint }
    if (request.objectId === f.deployment.callablePackageId) return { response: { object: structuredClone(f.pkg) } }
    const row = rows.get(request.objectId)
    if (!row || request.version !== BigInt(version)) throw Error('Exact historical object unavailable')
    return { response: { object: structuredClone(row) } }
  })
  const params = () => ({ ...f.params(), author, collectionId: collection.id, rightId: right.id, priceAtomic: listing.price })
  const edit = (objectId: string, change: (value: any, owner: any) => void) => {
    const d = structuredClone(definitions.get(objectId)!.value), original = definitions.get(objectId)!, owner = structuredClone(original.owner)
    change(d, owner); put(objectId, original.type, original.codec, d, owner, original.created); f.rehashEffects()
  }
  return { f, collection, right, kiosk, listing, itemId, markerId, minted, listed, rows, definitions, put, edit, params }
}

it('proves an actual SDK create+list transaction with canonical checkpoint and all six historical custody outputs', async () => {
  const t = await fixture(), result = await readCreatedCollectionListingReceipt(t.params())
  expect(result).toMatchObject({ collectionId: t.collection.id, rightId: t.right.id, listingId: t.listing.id,
    priceAtomic: '9007199254740993', checkpoint: '100', statusAtCreation: 'LISTED', currentStatus: 'NOT_READ', notAuthorization: true })
  expect(Object.isFrozen(result)).toBe(true)
  const reads = t.f.client.ledgerService.getObject.mock.calls.map(([request]) => request as any)
  expect(reads.filter(r => r.version !== undefined)).toHaveLength(6)
  expect(reads.every(r => r.version !== undefined || r.objectId === t.f.deployment.callablePackageId)).toBe(true)
})
it.each(['author', 'collection', 'right', 'price'])('rejects a mismatched caller %s hint without declaring creation listed', async field => {
  const t = await fixture(), params = t.params()
  if (field === 'author') params.author = id(900)
  if (field === 'collection') params.collectionId = id(900)
  if (field === 'right') params.rightId = id(900)
  if (field === 'price') params.priceAtomic = '1'
  await expect(readCreatedCollectionListingReceipt(params)).rejects.toThrow()
})
it.each(['duplicate', 'missing-mint', 'order', 'price', 'sender', 'wrong-origin'])('rejects rehashed %s event evidence', async mode => {
  const t = await fixture(), events = t.f.eventsData.data
  if (mode === 'duplicate') events.push(structuredClone(events[2]))
  if (mode === 'missing-mint') events.splice(1, 1)
  if (mode === 'order') [events[1], events[2]] = [events[2], events[1]]
  if (mode === 'price') events[2].contents = Listed.serialize({ ...t.listed, price: '1' }).toBytes()
  if (mode === 'sender') events[1].sender = id(900)
  if (mode === 'wrong-origin') { t.f.packageData.data.Package!.typeOriginTable.at(-1)!.package = id(900); t.f.rehashPackage() }
  t.f.rehashEvents(); await expect(readCreatedCollectionListingReceipt(t.params())).rejects.toThrow()
})
it.each(['root-holder', 'root-right', 'right-collection', 'right-parent', 'wrapper-value', 'wrapper-owner', 'kiosk-owner',
  'listing-price', 'listing-inactive', 'listing-cap', 'listing-owner', 'reservation-value', 'reservation-owner'])('rejects rehashed %s output contradiction', async mode => {
  const t = await fixture()
  if (mode === 'root-holder') t.edit(t.collection.id, v => { v.current_holder = id(900) })
  if (mode === 'root-right') t.edit(t.collection.id, v => { v.right_id = id(900) })
  if (mode === 'right-collection') t.edit(t.right.id, v => { v.collection_id = id(900) })
  if (mode === 'right-parent') t.edit(t.right.id, (_v, o) => { o.ObjectOwner = t.kiosk.id })
  if (mode === 'wrapper-value') t.edit(t.itemId, v => { v.value = id(900) })
  if (mode === 'wrapper-owner') t.edit(t.itemId, (_v, o) => { o.ObjectOwner = id(900) })
  if (mode === 'kiosk-owner') t.edit(t.kiosk.id, v => { v.owner = id(900) })
  if (mode === 'listing-price') t.edit(t.listing.id, v => { v.price = '1' })
  if (mode === 'listing-inactive') t.edit(t.listing.id, v => { v.is_active = false; v.purchase_cap = null })
  if (mode === 'listing-cap') t.edit(t.listing.id, v => { v.purchase_cap.item_id = id(900) })
  if (mode === 'listing-owner') t.edit(t.listing.id, (_v, o) => { delete o.Shared; o.AddressOwner = t.f.sender })
  if (mode === 'reservation-value') t.edit(t.markerId, v => { v.value = '1' })
  if (mode === 'reservation-owner') t.edit(t.markerId, (_v, o) => { o.ObjectOwner = id(900) })
  await expect(readCreatedCollectionListingReceipt(t.params())).rejects.toThrow()
})
it.each(['digest', 'not-created', 'not-written', 'missing-history', 'unconfirmed', 'checkpoint'])('rejects %s instead of using current object state', async mode => {
  const t = await fixture()
  if (mode === 'digest') t.rows.get(t.right.id).bcs.value[50] ^= 1
  if (mode === 'not-created') { const change = t.f.effectsData.V2!.changedObjects.find(([n]) => n === t.collection.id)![1]
    change.idOperation = { $kind: 'None', None: true }; change.inputState = { $kind: 'Exist', Exist: [['2', adigest(2)], { $kind: 'Shared', Shared: { initialSharedVersion: '1' } }] }; t.f.rehashEffects() }
  if (mode === 'not-written') { t.f.effectsData.V2!.changedObjects = t.f.effectsData.V2!.changedObjects.filter(([n]) => n !== t.listing.id); t.f.rehashEffects() }
  if (mode === 'missing-history') t.rows.delete(t.itemId)
  if (mode === 'unconfirmed') delete t.f.ledger.checkpoint
  if (mode === 'checkpoint') t.f.checkpoint.contents.bcs.value[0] ^= 1
  await expect(readCreatedCollectionListingReceipt(t.params())).rejects.toThrow()
})
it('bounded abort and retry read the same original transaction without broadcasts or current custody calls', async () => {
  const t = await fixture(), abort = new AbortController(); abort.abort()
  await expect(readCreatedCollectionListingReceipt({ ...t.params(), signal: abort.signal })).rejects.toThrow()
  expect(t.f.client.ledgerService.getTransaction).not.toHaveBeenCalled()
  expect((await readCreatedCollectionListingReceipt(t.params())).statusAtCreation).toBe('LISTED')
})
