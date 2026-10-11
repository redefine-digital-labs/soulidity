import { bcs, type BcsType } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, isValidTransactionDigest, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { EquipmentReadSet, EquipmentBaseItemBcs, EquipmentExternalItemBcs } from './native-equipment'
import { EquipmentDefinitionsBcs, EquipmentPackRegistryBcs, EquipmentBaseRegistryBcs, EquipmentItemRowBcs,
  EquipmentBaseHolderKeyBcs, EquipmentBaseOwnershipBcs, EquipmentExternalProductBcs } from './native-equipment-source-bcs'
import { EquipmentMarketListingBcs, EquipmentMarketQuoteCommitmentBcs } from './native-equipment-market-bcs'
import { readNativeEquipmentMarketAuthority } from './native-equipment-market-authority'
import { equipmentUtf8, equipmentBytesEqual } from './native-equipment-bytes'
import { decodeNativeBcs, NativeReceiveError, receiveId, type NativeReceiveTarget } from './native-receive'

type MarketPin = Parameters<typeof readNativeEquipmentMarketAuthority>[2]
type Authority = Awaited<ReturnType<typeof readNativeEquipmentMarketAuthority>>
type BaseItem = ReturnType<typeof EquipmentBaseItemBcs.parse>
type Listing = ReturnType<typeof EquipmentMarketListingBcs.parse>
type Kind = 'base' | 'external'
function quoteContext(authority:Authority){
  const root=authority.root,hex=(v:number[])=>toHex(new Uint8Array(v))
  return {makerVersion:root.maker_version,rootContentCommitment:hex(root.content.content_commitment),
    economicsCommitment:hex(root.economics.commitment),rightsCommitment:hex(root.rights.commitment)}
}
const A = bcs.Address, S = bcs.string()
const ZERO = `0x${'0'.repeat(64)}`
const eq = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.every((value, i) => value === b[i])
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_EQUIPMENT_MARKET_INVALID', message)
}
function kind(value: unknown): asserts value is Kind {
  check(value === 'base' || value === 'external', 'Unsupported equipment instance kind')
}

/** Runtime deliberately hashes the raw UTF-8 domain followed by the complete
 * canonical asset BCS, not a BCS vector containing the domain. */
export function equipmentMarketAssetCommitment(bytes: Uint8Array): number[] {
  const domain = equipmentUtf8('animacraft-v8/runtime/equipment-market-asset')
  const preimage = new Uint8Array(domain.length + bytes.length)
  preimage.set(domain); preimage.set(bytes, domain.length)
  return [...sha256(preimage)]
}

async function field<T, I>(reads: EquipmentReadSet, parent: string, keyType: string,
  keySchema: BcsType<any, any>, key: unknown, valueType: string, schema: BcsType<T, I>, optional = false) {
  receiveId(parent)
  const keyBytes = keySchema.serialize(key).toBytes(), id = deriveDynamicFieldID(parent, keyType, keyBytes)
  const type = `0x2::dynamic_field::Field<${keyType},${valueType}>`
  const bytes = optional ? await reads.optional(id, type, 2, parent) : await reads.read(id, type, 2, parent)
  if (bytes === null) return null
  const row = decodeNativeBcs(bcs.struct('Field', { id: A, name: keySchema, value: schema }), bytes)
  check(row.id === id && equipmentBytesEqual(keySchema.serialize(row.name).toBytes(), keyBytes), 'Equipment record key mismatch')
  return row.value
}

async function baseSource(reads: EquipmentReadSet, authority: Authority, item: BaseItem, listingEntry: boolean) {
  const { root, rt, ct } = authority, ids = root.publication.registry_ids!
  const definitions = decodeNativeBcs(EquipmentDefinitionsBcs, await reads.read(receiveId(ids.runtime_definition_registry_id), rt('RuntimeDefinitionRegistryV8'), 3))
  const packs = decodeNativeBcs(EquipmentPackRegistryBcs, await reads.read(receiveId(ids.pack_registry_id), rt('PackRegistryV8'), 3))
  for (const row of [definitions, packs]) check(row.version === '8' && row.root_id === root.id
    && row.root_version === root.maker_version && eq(row.root_content_commitment, root.content.content_commitment), 'Equipment registry Root mismatch')
  check(definitions.id === ids.runtime_definition_registry_id && packs.id === ids.pack_registry_id
    && definitions.sealed && definitions.item_assetization && packs.definition_registry_id === definitions.id
    && eq(packs.admission_policy_commitment, root.expected_pack_admission_policy_commitment)
    && item.definition_registry_id === definitions.id && item.pack_registry_id === packs.id
    && definitions.base_registry_id === root.base_registry_id && item.base_registry_id === definitions.base_registry_id
    && item.root_id === root.id && item.root_version === root.maker_version
    && eq(item.root_content_commitment, root.content.content_commitment), 'Base instance registry mismatch')
  const ownership = await field(reads, packs.base_item_owners.id, rt('BaseItemHolderKeyV8'), EquipmentBaseHolderKeyBcs,
    { part_key: item.part_key, item_key: item.item_key, holder: item.holder }, rt('BaseItemOwnershipRecordV8'), EquipmentBaseOwnershipBcs)
  check(ownership?.item_id === item.id && ownership.ownership_epoch === item.ownership_epoch, 'Base holder entitlement mismatch')
  // Only entering custody reads author publication rows. Returning or buying a
  // previously frozen instance uses the existing Runtime registry/holder checks.
  if (listingEntry) {
    const base = decodeNativeBcs(EquipmentBaseRegistryBcs, await reads.read(item.base_registry_id, ct('base_registry_v8', 'BaseDefinitionRegistryV8'), 3))
    check(base.id === item.base_registry_id && base.version === '8' && base.sealed && base.sealed_commitments
      && base.root_id === root.id && base.maker_version === root.maker_version
      && eq(base.root_content_commitment, root.content.content_commitment)
      && root.publication.sealed_base_registry_commitment
      && eq(base.sealed_commitments.aggregate, root.publication.sealed_base_registry_commitment), 'Base definition seal mismatch')
    const row = await field(reads, base.id, ct('base_registry_v8', 'ItemKeyV8'),
      bcs.struct('ItemKeyV8', { part_key: S, item_key: S }), { part_key: item.part_key, item_key: item.item_key },
      ct('base_registry_v8', 'ItemRowV2'), EquipmentItemRowBcs)
    check(row?.part_key === item.part_key && row.item_key === item.item_key && row.status === 0
      && eq(row.payload_commitment, item.item_payload_commitment), 'Base item publication mismatch')
  }
  return { packRegistryId: packs.id, definitionRegistryId: definitions.id, baseRegistryId: item.base_registry_id,
    holderTableId: packs.base_item_owners.id }
}

async function instance(client: SuiGrpcClient, reads: EquipmentReadSet, authority: Authority,
  itemId: string, assetKind: Kind, addressOwner: string, holder: string, listingEntry: boolean) {
  const type = authority.rt(assetKind === 'base' ? 'OwnedBaseItemV8' : 'OwnedExternalItemV8')
  const { response } = await client.ledgerService.getObject({ objectId: itemId,
    readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents'] } })
  const bytes = reads.accept(response.object, itemId, type, 1, addressOwner)
  check(response.object?.digest && isValidTransactionDigest(response.object.digest)
    && response.object.version !== undefined && response.object.version <= (1n << 64n) - 1n, 'Exact equipment object reference unavailable')
  const receiving = { objectId: itemId, version: String(response.object.version), digest: response.object.digest }
  const item = assetKind === 'base' ? decodeNativeBcs(EquipmentBaseItemBcs, bytes) : decodeNativeBcs(EquipmentExternalItemBcs, bytes)
  check(item.id === itemId && item.version === '8' && item.holder === holder, 'Equipment instance identity/holder mismatch')
  receiveId(item.holder)
  if (item.equip_lock) {
    receiveId(item.equip_lock.loadout_id)
    check(BigInt(item.equip_lock.selection_index) < 500n, 'Equipment lock slot exceeds capacity')
  }
  const base = assetKind === 'base' ? await baseSource(reads, authority, item as BaseItem, listingEntry) : null
  if (assetKind === 'external' && listingEntry) {
    const external = item as ReturnType<typeof EquipmentExternalItemBcs.parse>
    const product = decodeNativeBcs(EquipmentExternalProductBcs,
      await reads.read(receiveId(external.product_id), authority.rt('ExternalItemProductV8'), 3))
    check(product.id === external.product_id && product.version === '8' && product.root_id === authority.root.id
      && product.root_version === authority.root.maker_version && eq(product.root_content_commitment, authority.root.content.content_commitment)
      && eq(product.content_commitment, external.product_content_commitment)
      && eq(product.asset_content_commitment, external.asset_content_commitment)
      && product.transferable === external.transferable, 'External product identity/content mismatch')
    // No lifecycle/admission/access gate: already-issued instances can resell.
  }
  return { kind: assetKind, item, base, receiving, assetCommitment: equipmentMarketAssetCommitment(bytes!) }
}

/** An exact wallet instance, never candidate pagination or inferred ownership.
 * A locked instance remains visible but needs the separately certified partial
 * removal plan before listing; it is not directly signable from this result. */
export async function readOwnedEquipmentMarketSnapshot(client: SuiGrpcClient, target: NativeReceiveTarget,
  marketPin: MarketPin, input: { rootId: string; itemId: string; kind: Kind; owner: string }, signal?: AbortSignal,
  sharedReads?: EquipmentReadSet) {
  const pin = structuredClone(target), market = structuredClone(marketPin), request = structuredClone(input)
  ;[request.rootId, request.itemId, request.owner].forEach(receiveId); kind(request.kind)
  signal?.throwIfAborted()
  const reads = sharedReads ?? new EquipmentReadSet(client, true)
  const authority = await readNativeEquipmentMarketAuthority(client, pin, market, reads, request.rootId)
  const asset = await instance(client, reads, authority, request.itemId, request.kind, request.owner, request.owner, true)
  signal?.throwIfAborted(); await reads.verify(); signal?.throwIfAborted()
  return { schema: 'native-equipment-market-owned-v1' as const, rootId: authority.root.id,
    target: authority.sdkTarget, owner: request.owner, asset,quoteContext:quoteContext(authority),
    protocolTreasuryId:authority.protocolTreasury?.id??null,
    current: authority.current, requiresUnequip: asset.item.equip_lock !== null,
    listAvailable: authority.current && asset.item.transferable && asset.item.equip_lock === null }
}

function quote(authority: Authority, listing: Listing) {
  const root = authority.root, gross = BigInt(listing.gross_atomic), fee = gross * 250n / 10000n
  check(gross >= 40n && root.economics.soul_market_fee_bps === 250
    && listing.protocol_atomic === String(fee) && listing.seller_atomic === String(gross - fee)
    && listing.creator_atomic === '0' && listing.source_atomic === '0', 'Equipment frozen fee distribution mismatch')
  const commitment = [...sha256(EquipmentMarketQuoteCommitmentBcs.serialize({
    domain: [...equipmentUtf8('animacraft-v8/market/quote')], version: '8', quote_kind: 3,
    root_id: root.id, maker_version: root.maker_version, root_content_commitment: root.content.content_commitment,
    economics_commitment: root.economics.commitment, rights_commitment: root.rights.commitment,
    gross_atomic: listing.gross_atomic, protocol_atomic: listing.protocol_atomic, creator_atomic: '0', source_atomic: '0',
    seller_atomic: listing.seller_atomic,
  }).toBytes())]
  check(eq(listing.quote_commitment, commitment), 'Equipment frozen quote commitment mismatch')
  return { grossAtomic: String(gross), protocolAtomic: String(fee), sellerAtomic: String(gross - fee),
    creatorAtomic: '0', sourceAtomic: '0', feeBps: 250, commitment: toHex(new Uint8Array(commitment)) }
}

/** Open listings prove the address-owned child and its full-object commitment.
 * Terminal listings prove their frozen outcome without requiring a child that
 * legitimately left custody and may have changed owners again afterwards. */
export async function readEquipmentMarketListingSnapshot(client: SuiGrpcClient, target: NativeReceiveTarget,
  marketPin: MarketPin, input: { rootId: string; listingId: string; actor?: string }, signal?: AbortSignal,
  sharedReads?: EquipmentReadSet) {
  const pin = structuredClone(target), market = structuredClone(marketPin), request = structuredClone(input)
  ;[request.rootId, request.listingId].forEach(receiveId)
  if (request.actor !== undefined) receiveId(request.actor)
  signal?.throwIfAborted()
  const reads = sharedReads ?? new EquipmentReadSet(client, true)
  const authority = await readNativeEquipmentMarketAuthority(client, pin, market, reads, request.rootId)
  const { root, config, registry, treasury, catalog } = authority
  const listing = decodeNativeBcs(EquipmentMarketListingBcs, await reads.read(request.listingId,
    `${authority.mt('EquipmentListingV8')}<${authority.coin}>`, 3))
  const custody = listing.custody
  check(listing.id === request.listingId && listing.version === '8' && [0, 1, 2, 3].includes(listing.status)
    && listing.root_id === root.id && listing.maker_version === root.maker_version
    && eq(listing.root_content_commitment, root.content.content_commitment)
    && listing.registry_id === registry.id && listing.treasury_id === treasury.id
    && listing.package_config_id === config.id, 'Equipment listing scope/state mismatch')
  check(custody.version === '8' && custody.listing_id === listing.id && custody.catalog_id === catalog.id
    && eq(custody.product_binding_commitment, catalog.binding.commitment)
    && eq(custody.call_cap_set_commitment, catalog.call_cap_set_commitment)
    && custody.market_authority_id === catalog.authority_ids[4] && custody.market_registry_id === registry.id
    && custody.market_treasury_id === treasury.id && custody.root_id === root.id
    && custody.maker_version === root.maker_version && eq(custody.root_content_commitment, root.content.content_commitment)
    && [0, 2].includes(custody.asset_kind) && custody.asset_commitment.length === 32, 'Equipment custody binding mismatch')
  receiveId(custody.holder); receiveId(custody.asset_id); receiveId(custody.source_id)
  check(![listing.id, root.id, config.id, registry.id, treasury.id].includes(custody.asset_id), 'Equipment asset aliases authority')
  const open = listing.status === 0
  check(open ? listing.terminal_recipient === ZERO : listing.revision !== '0'
    && (listing.status === 1 ? listing.terminal_recipient !== ZERO && listing.terminal_recipient !== custody.holder
      : listing.terminal_recipient === custody.holder), 'Equipment terminal recipient/revision mismatch')
  const frozenQuote = quote(authority, listing)
  const asset = open ? await instance(client, reads, authority, custody.asset_id,
    custody.asset_kind === 0 ? 'base' : 'external', listing.id, custody.holder, false) : null
  if (asset) check(asset.item.transferable && asset.item.equip_lock === null
    && asset.item.ownership_epoch === custody.ownership_epoch
    && eq(asset.assetCommitment, custody.asset_commitment)
    && ('base_registry_id' in asset.item ? asset.item.base_registry_id : asset.item.product_id) === custody.source_id,
  'Equipment child differs from frozen custody')
  let buyerAlreadyOwns = false
  if (asset?.base && request.actor && request.actor !== custody.holder) {
    const item = asset.item as BaseItem
    const parent = asset.base.holderTableId, keyType = authority.rt('BaseItemHolderKeyV8')
    const key = { part_key: item.part_key, item_key: item.item_key, holder: request.actor }
    const recordType = authority.rt('BaseItemOwnershipRecordV8')
    const record = await field(reads, parent, keyType, EquipmentBaseHolderKeyBcs, key, recordType, EquipmentBaseOwnershipBcs, true)
    if (record) { receiveId(record.item_id); buyerAlreadyOwns = true }
  }
  signal?.throwIfAborted(); await reads.verify(); signal?.throwIfAborted()
  return { schema: 'native-equipment-market-listing-v1' as const, target: authority.sdkTarget,
    rootId: root.id, listing, quote: frozenQuote, asset, buyerAlreadyOwns, current: authority.current,
    quoteContext:quoteContext(authority),protocolTreasuryId:authority.protocolTreasury?.id??null,
    buyAvailable: open && authority.current && !!request.actor && request.actor !== custody.holder && !buyerAlreadyOwns,
    cancelAvailable: open && request.actor === custody.holder,
    recoverAvailable: open && authority.recoverable }
}

/** Post-transaction ownership read, independent of author publication lifecycle.
 * The current address owner must be the actual holder or a certified open
 * EquipmentListing, never an arbitrary address assumed to be an escrow. */
export async function readEquipmentMarketCustodySnapshot(client:SuiGrpcClient,target:NativeReceiveTarget,
  marketPin:MarketPin,input:{rootId:string;itemId:string;kind:Kind},signal?:AbortSignal,sharedReads?:EquipmentReadSet){
  const pin=structuredClone(target),market=structuredClone(marketPin),request=structuredClone(input)
  ;[request.rootId,request.itemId].forEach(receiveId);kind(request.kind);signal?.throwIfAborted()
  const reads=sharedReads??new EquipmentReadSet(client,true)
  const authority=await readNativeEquipmentMarketAuthority(client,pin,market,reads,request.rootId)
  const {response}=await client.ledgerService.getObject({objectId:request.itemId,
    readMask:{paths:['object_id','version','digest','owner','object_type','contents']}})
  check(response.object?.owner?.kind===1,'Equipment current address custody unavailable')
  const addressOwner=receiveId(response.object.owner.address)
  const bytes=reads.accept(response.object,request.itemId,authority.rt(request.kind==='base'?'OwnedBaseItemV8':'OwnedExternalItemV8'),1,addressOwner)
  const item=request.kind==='base'?decodeNativeBcs(EquipmentBaseItemBcs,bytes):decodeNativeBcs(EquipmentExternalItemBcs,bytes)
  const asset=await instance(client,reads,authority,request.itemId,request.kind,addressOwner,receiveId(item.holder),false)
  let listingId:string|null=null
  if(addressOwner!==item.holder){
    const listed=await readEquipmentMarketListingSnapshot(client,pin,market,
      {rootId:request.rootId,listingId:addressOwner},signal,reads)
    check(listed.listing.status===0&&listed.asset?.item.id===request.itemId&&listed.asset.kind===request.kind
      &&listed.asset.receiving.version===asset.receiving.version&&listed.asset.receiving.digest===asset.receiving.digest,
    'Current equipment owner is not its certified listing')
    listingId=addressOwner
  }
  signal?.throwIfAborted();await reads.verify();signal?.throwIfAborted()
  return {addressOwner,listingId,asset}
}
