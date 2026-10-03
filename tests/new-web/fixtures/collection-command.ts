import { vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { normalizeStructTag, toBase64, toBase58, fromBase64 } from '@mysten/sui/utils'
import { SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicKioskBcs, SoulPublicMarketConfigBcs, SOUL_PUBLIC_USDC_TYPE,
  CollectionPublicListingBcs, CollectionKioskRegistryBcs, CollectionKioskRegistrationFieldBcs, CollectionPersonalKioskCapBcs,
  CollectionKioskListingFieldBcs, deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '@soulidity/sdk'
import { collectionCommandHash, collectionCommandTypes, collectionCommandRegistration, collectionCommandMarker,
  type CollectionCommandRequest, type CollectionCommandRecord } from '../../../web/lib/collections/collection-command-plan'
import { prepareCollectionCommandPlan } from '../../../web/lib/collections/collection-command-state'
import { buildCollectionCommandTransaction, createCollectionCommandAdapter } from '../../../web/lib/collections/collection-command-operation'
import { activityEvidenceFixture, activityGenesis, ActivityFixtureEventsBcs } from './activity-transaction-evidence'

export const cid = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const previous = toBase58(new Uint8Array(32).fill(7)), shared = { Shared: { initialSharedVersion: '1' } }
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
type Owner = Parameters<typeof bcs.Owner.serialize>[0]

/** Controlled ledger, not Move execution or a validator certificate. Full
 * canonical Objects, SDK-built PTBs, Ed25519 signatures and checkpoint hash
 * membership are real; Move behavior is independently tested in Move tests. */
export async function collectionCommandFixture(action: CollectionCommandRequest['action'] = 'list', options: { feeBps?: number; price?: string; paused?: boolean; markerOptimized?: boolean } = {}) {
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(52)), author = signer.toSuiAddress()
  const target = { originalPackageId: cid(90), callablePackageId: cid(91), callableDigest: '', chainIdentifier: '35834a8a',
    marketConfigId: cid(94), kioskRegistryId: cid(95), personalKioskTypePackageId: cid(96), paymentCoinType: SOUL_PUBLIC_USDC_TYPE }
  const c = { id: cid(10), version: '1', creator: author, extra_royalty_bps: 500, tradeable: true, current_holder: author,
    current_holder_kiosk_id: cid(11), right_id: cid(12), max_supply: null as string | null, current_supply: '0' }
  const right = { id: c.right_id, version: '1', collection_id: c.id, creator: author, name: 'Collection', description: 'Royalty Right', image_url: 'https://example.com/right.png' }
  const kiosk = { id: c.current_holder_kiosk_id, profits: '0', owner: author, item_count: 1, allow_extensions: true }
  const listing = { id: cid(13), version: '1', collection_id: c.id, right_id: right.id, seller: author, seller_kiosk_id: kiosk.id,
    price: '1000001', purchase_cap: { id: cid(14), kiosk_id: kiosk.id, item_id: right.id, min_price: '0' }, is_active: true }
  const registry = { id: target.kioskRegistryId, version: '1' }, types = collectionCommandTypes(target)
  const cap = { id: cid(98), cap: { id: cid(99), for: kiosk.id } }, regId = collectionCommandRegistration(target, author)
  const reg = { id: regId, name: { owner: author }, value: { version: '1', kiosk_id: kiosk.id, kiosk_cap_id: cap.id } }
  const market = { id: target.marketConfigId, version: '2', legacy_config_id: cid(0), fee_recipient: cid(97),
    platform_fee_bps: options.feeBps ?? 50, primary_enabled: true, secondary_enabled: !options.paused }
  const rows = new Map<string, any>(), current = new Map<string, any>(), objects = new Map<string, ReturnType<typeof bcs.Object.parse>>()
  function full(objectId: string, type: string, codec: Codec, value: any, ownerInput: Owner, version = '11', txDigest = previous) {
    const owner = bcs.Owner.parse(bcs.Owner.serialize(ownerInput).toBytes()), contents = codec.serialize(value).toBytes()
    const tag = TypeTagSerializer.parseFromStr(type)
    if (!('struct' in tag)) throw new Error('Fixture Move object type must be a struct')
    const moveType = type === '0x2::coin::Coin<0x2::sui::SUI>' ? { GasCoin: true as const } : { Other: tag.struct }
    const hasPublicTransfer = type === types.right || type === types.kiosk || type === '0x2::coin::Coin<0x2::sui::SUI>'
    const object = bcs.Object.parse(bcs.Object.serialize({ data: { Move: { type: moveType, hasPublicTransfer, version, contents } },
      owner, previousTransaction: txDigest, storageRebate: '0' }).toBytes())
    const bytes = bcs.Object.serialize(object).toBytes(), digest = collectionCommandHash('Object', bytes)
    const row = { objectId, objectType: normalizeStructTag(type), version: BigInt(version), digest, previousTransaction: txDigest,
      owner: owner.Shared ? { kind: 3, version: BigInt(owner.Shared.initialSharedVersion) } : owner.ObjectOwner ? { kind: 2, address: owner.ObjectOwner }
        : { kind: 1, address: owner.AddressOwner }, contents: { value: contents }, bcs: { value: bytes } }
    rows.set(`${objectId}:${version}`, row); objects.set(`${objectId}:${version}`, object)
    if (version === '11') current.set(objectId, row)
    return row
  }
  const packageRaw = bcs.Object.parse(bcs.Object.serialize({ data: { Package: { id: target.callablePackageId, version: '2',
    moduleMap: new Map([['market', new Uint8Array([1])], ['collection', new Uint8Array([2])]]),
    typeOriginTable: [['collection', 'SoulCollection'], ['collection', 'SoulCollectionRight'], ...['CollectionListing', 'MarketConfigV2', 'KioskRegistry',
      'PersonalKioskRegistration', 'PersonalKioskOwnerKey', 'CollectionListed', 'CollectionListingCancelled'].map(name => ['market', name])]
      .map(([moduleName, datatypeName]) => ({ moduleName, datatypeName, package: target.originalPackageId })), linkageTable: new Map(),
  } }, owner: { Immutable: true }, previousTransaction: previous, storageRebate: '0' }).toBytes())
  const packageBytes = bcs.Object.serialize(packageRaw).toBytes(); target.callableDigest = collectionCommandHash('Object', packageBytes)
  current.set(target.callablePackageId, { objectId: target.callablePackageId, version: 2n, digest: target.callableDigest,
    owner: { kind: 4 }, previousTransaction: previous, bcs: { value: packageBytes } })
  full(c.id, types.collection, SoulPublicCollectionBcs, c, shared)
  full(kiosk.id, types.kiosk, SoulPublicKioskBcs, kiosk, shared)
  const itemId = deriveKioskItemFieldId(kiosk.id, right.id)
  full(itemId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs, { id: itemId, name: { name: { id: right.id } }, value: right.id }, { ObjectOwner: kiosk.id })
  full(right.id, types.right, SoulPublicCollectionRightBcs, right, { ObjectOwner: itemId })
  full(registry.id, types.registry, CollectionKioskRegistryBcs, registry, shared)
  full(regId, types.registration, CollectionKioskRegistrationFieldBcs, reg, { ObjectOwner: registry.id })
  full(cap.id, types.cap, CollectionPersonalKioskCapBcs, cap, { AddressOwner: author })
  full(market.id, types.market, SoulPublicMarketConfigBcs, market, shared)
  full(listing.id, types.listing, CollectionPublicListingBcs, listing, shared)
  const markerId = collectionCommandMarker(kiosk.id, right.id, true), markerValue = { id: markerId, name: { id: right.id, is_exclusive: true }, value: '0' }
  if (action !== 'list') full(markerId, types.marker, CollectionKioskListingFieldBcs, markerValue, { ObjectOwner: kiosk.id })
  const gasId = cid(900), Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
  const gas = full(gasId, '0x2::coin::Coin<0x2::sui::SUI>', Coin, { id: gasId, balance: '10000000' }, { AddressOwner: author })
  const resolve = vi.fn(async (data: TransactionDataBuilder, _options: unknown, next: () => Promise<void>) => {
    data.inputs = data.inputs.map(input => input.UnresolvedObject ? Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId,
      initialSharedVersion: '1', mutable: [kiosk.id, registry.id, listing.id].includes(input.UnresolvedObject.objectId) }) : input)
    data.gasData = { owner: author, budget: '1000000', price: '1', payment: [{ objectId: gasId, version: '11', digest: gas.digest }] }; await next()
  })
  const client = { core: { resolveTransactionPlugin: () => resolve, getChainIdentifier: vi.fn(async () => ({ chainIdentifier: activityGenesis })),
    getProtocolConfig: vi.fn(async () => ({ protocolConfig: { attributes: { max_tx_size_bytes: '131072', max_programmable_tx_commands: '1024', max_pure_argument_size: '16384' } } })),
    executeTransaction: vi.fn(async (_input: { transaction: Uint8Array; signatures: string[] }) => ({})) }, ledgerService: {
    batchGetObjects: vi.fn(async ({ requests }: { requests: Array<{ objectId: string }> }) => ({ response: {
      objects: requests.map(({ objectId }) => ({ result: current.has(objectId) ? { oneofKind: 'object', object: structuredClone(current.get(objectId)) }
        : { oneofKind: 'error', error: { code: 5 } } })) } })),
    getObject: vi.fn(async ({ objectId, version }: any) => { const row = rows.get(`${objectId}:${version}`)
      if (!row) throw new Error('Exact historical object unavailable'); return { response: { object: structuredClone(row) } } }),
    getEpoch: vi.fn(async () => ({ response: { epoch: { epoch: 9n } } })), getTransaction: vi.fn(), getCheckpoint: vi.fn(),
    getServiceInfo: vi.fn(async () => ({ response: { chainId: activityGenesis } })),
  }, transactionExecutionService: { simulateTransaction: vi.fn(async (input: any) => ({ response: { transaction: {
    transaction: { bcs: { value: new Uint8Array(input.transaction.bcs.value) } }, effects: { status: { success: true } } } } })) } }
  const params = { client: client as never, target, author, request: { action, collectionId: c.id,
    priceAtomic: action === 'delist' ? null : options.price ?? '2000001' }, listingObjectOnChainId: action === 'list' ? null : listing.id }
  const plan = await prepareCollectionCommandPlan(params)
  async function packet(mutate?: (data: TransactionDataBuilder) => void): Promise<CollectionCommandRecord> {
    const tx = buildCollectionCommandTransaction(plan); tx.setSender(author); tx.setExpiration({ Epoch: '10' })
    const bytes = await tx.build({ client: client as never }), data = new TransactionDataBuilder(Transaction.from(bytes).getData()); mutate?.(data)
    const exact = data.build(), signed = await signer.signTransaction(exact)
    return { schema: 'soulidity.collection-command.v1', plan: structuredClone(plan), packet: { bytes: toBase64(exact),
      digest: TransactionDataBuilder.getDigestFromBytes(exact), expirationEpoch: '10', phase: 'SIGNED', signature: signed.signature } }
  }
  const record = await packet(), evidence = await activityEvidenceFixture()
  evidence.transactionData.V1 = bcs.TransactionData.parse(fromBase64(record.packet.bytes)).V1
  const effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { status: { Success: true }, executedEpoch: '9',
    gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' }, transactionDigest: record.packet.digest,
    gasObjectIndex: 0, eventsDigest: null, dependencies: [], lamportVersion: '12', changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null } }).toBytes())
  function transition(objectId: string, type: string, codec: Codec, before: any | null, after: any | null, owner: Owner, readonly = false) {
    const input = before === null ? null : full(objectId, type, codec, before, owner)
    if (readonly) { effects.V2!.unchangedConsensusObjects.push([objectId, { $kind: 'ReadOnlyRoot', ReadOnlyRoot: ['11', input!.digest] }]); return }
    const output = after === null ? null : full(objectId, type, codec, after,
      before === null && 'Shared' in owner ? { Shared: { initialSharedVersion: '12' } } : owner, '12', record.packet.digest)
    const ownerOf = (row: any) => bcs.Object.parse(row.bcs.value).owner
    effects.V2!.changedObjects.push([objectId, { inputState: input ? { $kind: 'Exist', Exist: [['11', input.digest], ownerOf(input)] } : { $kind: 'NotExist', NotExist: true },
      outputState: output ? { $kind: 'ObjectWrite', ObjectWrite: [output.digest, ownerOf(output)] } : { $kind: 'NotExist', NotExist: true },
      idOperation: !output ? { $kind: 'Deleted', Deleted: true } : !input ? { $kind: 'Created', Created: true } : { $kind: 'None', None: true } }])
  }
  transition(gasId, '0x2::coin::Coin<0x2::sui::SUI>', Coin, { id: gasId, balance: '10000000' }, { id: gasId, balance: '9999999' }, { AddressOwner: author })
  transition(c.id, types.collection, SoulPublicCollectionBcs, c, c, shared, true)
  transition(kiosk.id, types.kiosk, SoulPublicKioskBcs, kiosk, kiosk, shared)
  if (action !== 'delist') { transition(market.id, types.market, SoulPublicMarketConfigBcs, market, market, shared, true)
    transition(registry.id, types.registry, CollectionKioskRegistryBcs, registry, registry, shared) }
  if (action !== 'list') transition(listing.id, types.listing, CollectionPublicListingBcs, listing, { ...listing, is_active: false, purchase_cap: null }, shared)
  const newListing = action === 'delist' ? null : { ...listing, id: cid(700), price: plan.request.priceAtomic!, purchase_cap: { ...listing.purchase_cap, id: cid(701) } }
  if (newListing) transition(newListing.id, types.listing, CollectionPublicListingBcs, null, newListing, shared)
  // Approved Sui 722 effects preserve created/deleted wrapped UIDs, even
  // though no independent historical object exists at that UID/version.
  if (action !== 'list') effects.V2!.changedObjects.push([listing.purchase_cap.id, { inputState: { $kind: 'NotExist', NotExist: true },
    outputState: { $kind: 'NotExist', NotExist: true }, idOperation: { $kind: 'Deleted', Deleted: true } }])
  if (newListing) effects.V2!.changedObjects.push([newListing.purchase_cap.id, { inputState: { $kind: 'NotExist', NotExist: true },
    outputState: { $kind: 'NotExist', NotExist: true }, idOperation: { $kind: 'Created', Created: true } }])
  if (action !== 'reprice' || !options.markerOptimized) transition(markerId, types.marker, CollectionKioskListingFieldBcs,
    action === 'list' ? null : markerValue, action === 'delist' ? null : markerValue, { ObjectOwner: kiosk.id })
  // Keep current state separate from historical outputs in the controlled ledger.
  if (action === 'list') current.delete(markerId)
  const Listed = bcs.struct('CollectionListed', { listing_id: bcs.Address, collection_id: bcs.Address, right_id: bcs.Address,
    seller: bcs.Address, kiosk_id: bcs.Address, price: bcs.u64() })
  const Cancelled = bcs.struct('CollectionListingCancelled', { listing_id: bcs.Address, collection_id: bcs.Address, seller: bcs.Address })
  const event = (name: string, contents: Uint8Array) => ({ package_id: target.callablePackageId, transaction_module: 'market', sender: author,
    type_: { address: target.originalPackageId, module: 'market', name, typeParams: [] }, contents })
  evidence.eventsData.data = ActivityFixtureEventsBcs.parse(ActivityFixtureEventsBcs.serialize({ data: [
    ...(action === 'list' ? [] : [event('CollectionListingCancelled', Cancelled.serialize({ listing_id: listing.id, collection_id: c.id, seller: author }).toBytes())]),
    ...(newListing ? [event('CollectionListed', Listed.serialize({ listing_id: newListing.id, collection_id: c.id, right_id: right.id, seller: author, kiosk_id: kiosk.id, price: newListing.price }).toBytes())] : []),
  ] }).toBytes()).data
  evidence.effectsData.V2 = effects.V2; evidence.summaryData.epoch = '9'; evidence.summaryData.sequence_number = '42'; evidence.rehashTransaction()
  client.ledgerService.getCheckpoint.mockImplementation(evidence.client.ledgerService.getCheckpoint)
  client.ledgerService.getTransaction.mockImplementation(async () => ({ response: { transaction: structuredClone(evidence.ledger) } }))
  let address: string | null = author
  const getAddress = vi.fn(() => address), read = vi.fn(async () => {}), sign = vi.fn(async (tx: Transaction) => signer.signTransaction(await tx.build()))
  const adapter = createCollectionCommandAdapter({ client: client as never, getAddress, read, sign })
  function editCurrent(objectId: string, codec: Codec, change: (value: any) => void) {
    const row = current.get(objectId), raw = bcs.Object.parse(row.bcs.value), value = codec.parse(raw.data.Move!.contents); change(value)
    full(objectId, row.objectType, codec, value, raw.owner, String(row.version), raw.previousTransaction)
  }
  return { params, client, target, author, signer, c, right, kiosk, registry, market, listing, newListing, cap, regId, itemId, markerId, types, current, rows, objects,
    full, editCurrent, plan, record, packet, effects, evidence, adapter, sign, read, getAddress, resolve, setAddress: (next: string | null) => { address = next } }
}
