import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { sha256 } from '@noble/hashes/sha2.js'
import { buildBuyAnimacraftEquipmentV8Tx } from '@soulidity/sdk'
import { nativeEquipmentMarketAuthorityFixture } from './fixtures/native-equipment-market-authority'
import { EquipmentBaseItemBcs, EquipmentExternalItemBcs } from '../../web/lib/animacraft/native-equipment'
import { EquipmentMakerBcs, EquipmentExternalProductBcs, EquipmentBaseHolderKeyBcs, EquipmentBaseOwnershipBcs,
  EquipmentDefinitionsBcs, EquipmentPackRegistryBcs } from '../../web/lib/animacraft/native-equipment-source-bcs'
import { EquipmentMarketListingBcs, EquipmentMarketQuoteCommitmentBcs, EquipmentMarketRegistryBcs,
  EquipmentMarketConfigBcs } from '../../web/lib/animacraft/native-equipment-market-bcs'
import { CompleteReadCatalogBcs } from '../../web/lib/animacraft/native-complete-read-bcs'
import { equipmentMarketAssetCommitment, readEquipmentMarketListingSnapshot, readOwnedEquipmentMarketSnapshot } from '../../web/lib/animacraft/native-equipment-market-read'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const ZERO = id(0), listingId = id(800), seller = id(11), buyer = id(900)
function fixture(kind: 'base' | 'external' = 'base') {
  const f = nativeEquipmentMarketAuthorityFixture()
  if (kind === 'external') f.addExternal()
  const itemId = kind === 'base' ? id(84) : id(102)
  const schema = kind === 'base' ? EquipmentBaseItemBcs : EquipmentExternalItemBcs
  f.set(itemId, schema, item => { item.equip_lock = null })
  const owned = () => readOwnedEquipmentMarketSnapshot(f.client, f.target, f.marketPin,
    { rootId: f.rootId, itemId, kind, owner: seller })
  function list() {
    const root = EquipmentMakerBcs.parse(f.objects.get(f.rootId).contents.value)
    const registry = EquipmentMarketRegistryBcs.parse(f.objects.get(f.ids.registry).contents.value)
    const catalog = CompleteReadCatalogBcs.parse(f.objects.get(f.ids.catalog).contents.value)
    const config = EquipmentMarketConfigBcs.parse(f.objects.get(f.ids.config).contents.value)
    const custody = { version: '8', catalog_id: catalog.id, product_binding_commitment: catalog.binding.commitment,
      call_cap_set_commitment: catalog.call_cap_set_commitment, market_authority_id: catalog.authority_ids[4],
      market_registry_id: registry.id, market_treasury_id: registry.treasury_id, listing_id: listingId,
      root_id: root.id, maker_version: root.maker_version, root_content_commitment: root.content.content_commitment,
      asset_id: itemId, asset_kind: kind === 'base' ? 0 : 2, source_id: kind === 'base' ? id(85) : id(101),
      asset_commitment: equipmentMarketAssetCommitment(f.objects.get(itemId).contents.value), holder: seller, ownership_epoch: '0' }
    const quote = { domain: [...new TextEncoder().encode('animacraft-v8/market/quote')], version: '8', quote_kind: 3,
      root_id: root.id, maker_version: root.maker_version, root_content_commitment: root.content.content_commitment,
      economics_commitment: root.economics.commitment, rights_commitment: root.rights.commitment,
      gross_atomic: '10001', protocol_atomic: '250', creator_atomic: '0', source_atomic: '0', seller_atomic: '9751' }
    f.put(listingId, `${f.mt('EquipmentListingV8')}<${f.coin}>`, EquipmentMarketListingBcs,
      { id: listingId, version: '8', registry_id: registry.id, treasury_id: registry.treasury_id,
        package_config_id: config.id, root_id: root.id, maker_version: root.maker_version,
        root_content_commitment: root.content.content_commitment, custody,
        gross_atomic: quote.gross_atomic, protocol_atomic: quote.protocol_atomic, creator_atomic: '0', source_atomic: '0',
        seller_atomic: quote.seller_atomic, quote_commitment: [...sha256(EquipmentMarketQuoteCommitmentBcs.serialize(quote).toBytes())],
        status: 0, revision: '9007199254740993', terminal_recipient: ZERO })
    f.objects.get(itemId).owner = { kind: 1, address: listingId }
    return quote
  }
  const read = (actor = buyer) => readEquipmentMarketListingSnapshot(f.client, f.target, f.marketPin,
    { rootId: f.rootId, listingId, actor })
  return { ...f, itemId, schema, kind, owned, list, read }
}

it.each(['base', 'external'] as const)('authenticates unlocked wallet %s without requiring Maker access or candidate inventory', async kind => {
  const f = fixture(kind), calls: string[] = []
  const get = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  f.client.ledgerService.getObject = (async (p: any) => { calls.push(p.objectId); return get(p) }) as never
  const s = await f.owned()
  expect(s).toMatchObject({ owner: seller, current: true, requiresUnequip: false, listAvailable: true,
    asset: { kind, item: { id: f.itemId, holder: seller, ownership_epoch: '0' } } })
  expect(calls).not.toContain(id(83)); expect(calls).not.toContain(id(80))
})

it('keeps a locked/nontransferable wallet instance visible but not directly listable', async () => {
  const f = fixture()
  f.set(f.itemId, EquipmentBaseItemBcs, item => { item.equip_lock = { loadout_id: id(80), equip_revision: '1', selection_index: '0' } })
  expect(await f.owned()).toMatchObject({ requiresUnequip: true, listAvailable: false })
  f.set(f.itemId, EquipmentBaseItemBcs, item => { item.equip_lock = null; item.transferable = false })
  expect(await f.owned()).toMatchObject({ requiresUnequip: false, listAvailable: false })
})

it.each(['base', 'external'] as const)('authenticates listed %s exact child/fee and constructs the SDK purchase reference', async kind => {
  const f = fixture(kind); f.list()
  const s = await f.read()
  expect(s).toMatchObject({ buyAvailable: true, cancelAvailable: false, recoverAvailable: false,
    quote: { grossAtomic: '10001', protocolAtomic: '250', sellerAtomic: '9751', creatorAtomic: '0', sourceAtomic: '0', feeBps: 250 },
    asset: { kind, receiving: { objectId: f.itemId, version: '2' }, item: { holder: seller } } })
  const tx = buildBuyAnimacraftEquipmentV8Tx({ target: s.target, listingId,
    expectedRevision: s.listing.revision, receiving: s.asset!.receiving,
    ...(kind === 'base' ? { kind, packRegistryId: s.asset!.base!.packRegistryId, definitionRegistryId: s.asset!.base!.definitionRegistryId } : { kind }),
    protocolTreasuryId: f.ids.protocolTreasury, priceAtomic: BigInt(s.quote.grossAtomic), paymentCoinObjectIds: [id(901)] })
  expect(tx.getData().commands.at(-1)?.MoveCall?.function).toBe(`purchase_${kind}_equipment_v8`)
  expect((await f.read(seller))).toMatchObject({ buyAvailable: false, cancelAvailable: true })
})

it('retains seller cancellation and permissionless recovery when Root is paused', async () => {
  const f = fixture(); f.list(); f.set(f.rootId, EquipmentMakerBcs, root => { root.lifecycle = 2 })
  expect(await f.read(seller)).toMatchObject({ current: false, buyAvailable: false, cancelAvailable: true, recoverAvailable: true })
})

it('does not require current external product/admission rows to return already frozen custody', async () => {
  const f = fixture('external'); f.list(); f.objects.delete(id(101))
  expect(await f.read(seller)).toMatchObject({ cancelAvailable: true })
  f.objects.get(f.itemId).owner.address = seller
  await expect(f.owned()).rejects.toThrow()
})

it('rejects a buyer already holding the same Base item without hiding its listing', async () => {
  const f = fixture(); f.list()
  f.field(id(95), f.runtimeType('BaseItemHolderKeyV8'), EquipmentBaseHolderKeyBcs,
    { part_key: 'body', item_key: 'hat', holder: buyer }, f.runtimeType('BaseItemOwnershipRecordV8'), EquipmentBaseOwnershipBcs,
    { item_id: id(904), ownership_epoch: '3' })
  expect(await f.read()).toMatchObject({ buyerAlreadyOwns: true, buyAvailable: false, asset: { kind: 'base' } })
})

it.each([1, 2, 3])('reads terminal status %s without a nonexistent custody child', async status => {
  const f = fixture(); f.list()
  f.set(listingId, EquipmentMarketListingBcs, listing => { listing.status = status; listing.terminal_recipient = status === 1 ? buyer : seller })
  f.objects.delete(f.itemId)
  expect(await f.read()).toMatchObject({ asset: null, buyAvailable: false, cancelAvailable: false, recoverAvailable: false,
    listing: { status, terminal_recipient: status === 1 ? buyer : seller } })
})

const malformed: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
  ['wrong address owner', f => { f.objects.get(f.itemId).owner.address = seller }],
  ['object-owned instead of Receiving-address-owned', f => { f.objects.get(f.itemId).owner.kind = 2 }],
  ['wrong type', f => { f.objects.get(f.itemId).objectType = f.runtimeType('OwnedExternalItemV8') }],
  ['bad object digest', f => { f.objects.get(f.itemId).digest = 'invalid' }],
  ['item trailing bytes', f => { const v = f.objects.get(f.itemId).contents.value; f.objects.get(f.itemId).contents.value = new Uint8Array([...v, 0]) }],
  ['child epoch', f => { f.set(f.itemId, EquipmentBaseItemBcs, v => { v.ownership_epoch = '1' }) }],
  ['child lock', f => { f.set(f.itemId, EquipmentBaseItemBcs, v => { v.equip_lock = { loadout_id: id(80), equip_revision: '1', selection_index: '0' } }) }],
  ['nontransferable child', f => { f.set(f.itemId, EquipmentBaseItemBcs, v => { v.transferable = false }) }],
  ['missing Base entitlement', f => { f.objects.delete(f.ownershipId) }],
  ['wrong registry', f => { f.set(id(81), EquipmentDefinitionsBcs, v => { v.root_id = id(910) }) }],
  ['listing Root', f => { f.set(listingId, EquipmentMarketListingBcs, v => { v.root_id = id(910) }) }],
  ['listing config', f => { f.set(listingId, EquipmentMarketListingBcs, v => { v.package_config_id = id(910) }) }],
  ['listing status', f => { f.set(listingId, EquipmentMarketListingBcs, v => { v.status = 4 }) }],
  ['open terminal recipient', f => { f.set(listingId, EquipmentMarketListingBcs, v => { v.terminal_recipient = buyer }) }],
  ['custody authority', f => { f.set(listingId, EquipmentMarketListingBcs, v => { v.custody.market_authority_id = id(910) }) }],
  ['custody parent', f => { f.set(listingId, EquipmentMarketListingBcs, v => { v.custody.listing_id = id(910) }) }],
  ['custody hash', f => { f.set(listingId, EquipmentMarketListingBcs, v => { v.custody.asset_commitment[0] ^= 1 }) }],
  ['Physical asset kind', f => { f.set(listingId, EquipmentMarketListingBcs, v => { v.custody.asset_kind = 1 }) }],
  ['wrong fee', f => { f.set(listingId, EquipmentMarketListingBcs, v => { v.protocol_atomic = '251'; v.seller_atomic = '9750' }) }],
  ['invented royalty', f => { f.set(listingId, EquipmentMarketListingBcs, v => { v.creator_atomic = '1'; v.seller_atomic = '9750' }) }],
  ['quote hash', f => { f.set(listingId, EquipmentMarketListingBcs, v => { v.quote_commitment[0] ^= 1 }) }],
]
it.each(malformed)('rejects %s in actual raw-object reads', async (_label, corrupt) => {
  const f = fixture(); f.list(); corrupt(f); await expect(f.read()).rejects.toThrow()
})

it('rejects External source substitution for a wallet sale', async () => {
  const f = fixture('external')
  f.set(id(101), EquipmentExternalProductBcs, p => { p.root_id = id(920) })
  await expect(f.owned()).rejects.toThrow('External product identity')
})

it.each([false, true])('rejects the wrong Pack policy commitment without an admission lookup (listed=%s)', async listed => {
  const f = fixture()
  if (listed) f.list()
  f.set(id(82), EquipmentPackRegistryBcs, p => { p.admission_policy_commitment = Array(32).fill(254) })
  await expect(listed ? f.read() : f.owned()).rejects.toThrow('registry mismatch')
})

it('rejects mutable listing drift during the final readset recheck', async () => {
  const f = fixture(); f.list()
  const get = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  f.client.ledgerService.getObject = (async (p: any) => {
    const result = await get(p)
    if (p.objectId === listingId && !p.readMask.paths.includes('contents')) {
      return { response: { object: { ...result.response.object, version: 999n } } }
    }
    return result
  }) as never
  await expect(f.read()).rejects.toThrow('changed')
})

it('rechecks a missing buyer entitlement rather than trusting cached NOT_FOUND', async () => {
  const f = fixture(); f.list()
  const get = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  let installed = false
  f.client.ledgerService.getObject = (async (p: any) => {
    if (!installed && p.objectId === listingId && !p.readMask.paths.includes('contents')) {
      installed = true
      f.field(id(95), f.runtimeType('BaseItemHolderKeyV8'), EquipmentBaseHolderKeyBcs,
        { part_key: 'body', item_key: 'hat', holder: buyer }, f.runtimeType('BaseItemOwnershipRecordV8'), EquipmentBaseOwnershipBcs,
        { item_id: id(904), ownership_epoch: '3' })
    }
    return get(p)
  }) as never
  await expect(f.read()).rejects.toThrow('absent object changed')
})

it('captures request and package pins before the first await', async () => {
  const f = fixture(); f.list()
  const request = { rootId: f.rootId, listingId, actor: buyer }, pin = structuredClone(f.marketPin)
  const pending = readEquipmentMarketListingSnapshot(f.client, f.target, pin, request)
  request.listingId = id(999); pin.callablePackageId = id(998)
  expect((await pending).listing.id).toBe(listingId)
})

it('honors cancellation before any raw lookup', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort()
  await expect(readOwnedEquipmentMarketSnapshot(f.client, f.target, f.marketPin,
    { rootId: f.rootId, itemId: f.itemId, kind: f.kind, owner: seller }, controller.signal)).rejects.toThrow()
})
