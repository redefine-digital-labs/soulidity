import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { toBase64, fromHex, normalizeStructTag, deriveDynamicFieldID } from '@mysten/sui/utils'
import { activityEvidenceFixture, activityHash, aid, adigest } from './activity-transaction-evidence'
import vm from './commerce-economics-vm.json'
import { EconomicsConfigBcs, NativeOfferBcs, economicsConfigSnapshot, economicsOperationalSnapshotHash } from '../../../web/lib/soulidity/commerce/economics-bcs'
import { quoteNativeSale, nativeSaleDistribution } from '../../../web/lib/soulidity/commerce/native-sale-quote'
import { buildNativeSaleGraph, type NativeSaleGraphPlan } from '../../../web/lib/soulidity/commerce/native-sale-graph'
import { batchHistoryFixture } from './walrus-batch-history'
import { SaleCollectionBcs, SaleCollectionMemberBcs } from '../../../web/lib/soulidity/commerce/collection-sale-proof'
import { NativeExclusiveListingFieldBcs } from '../../../web/lib/soulidity/commerce/native-sale-cancellation'

// Controlled original objects/effects using actual SDK transaction bytes and
// actual VM Config layout. No executed sale/mainnet result is claimed.
export async function commerceSaleMoneyFixture(variant = '', buyerAccount?: NativeSaleGraphPlan['buyerAccount'], buyerAddress?: string) {
  const f = await activityEvidenceFixture(), foundation = await activityEvidenceFixture(), collection = await activityEvidenceFixture()
  const before = EconomicsConfigBcs.parse(fromHex(vm.sections.ENABLED.config)), native = f.deployment
  const pin = (fixture: typeof f, original: string, callable: string, definitions: string[]) => {
    fixture.deployment.originalPackageId = original; fixture.deployment.callablePackageId = callable
    const pkg = fixture.packageData.data.Package!; pkg.id = callable
    pkg.moduleMap = new Map([...new Set(definitions.map(row => row.split('::')[0]))].map(module => [module, new Uint8Array([1])]))
    pkg.typeOriginTable = definitions.map(row => ({ moduleName: row.split('::')[0], datatypeName: row.split('::')[1], package: original })); fixture.rehashPackage()
  }
  pin(f, aid(10), aid(11), ['market::Offer', 'market::Sold']); pin(foundation, before.original_package, before.callable_package, ['economics::Config', 'economics::Paid'])
  pin(collection, aid(80), aid(81), ['collection::Collection'])
  const pkg = f.packageData.data.Package!
  pkg.linkageTable = new Map([[foundation.deployment.originalPackageId, { upgradedId: foundation.deployment.callablePackageId, upgradedVersion: '2' }],
    [collection.deployment.originalPackageId, { upgradedId: collection.deployment.callablePackageId, upgradedVersion: '2' }]])
  pkg.typeOriginTable.push({ moduleName: 'market', datatypeName: 'MarketAuthority1', package: aid(10) }, { moduleName: 'market', datatypeName: 'MarketRevision1', package: aid(11) })
  f.rehashPackage()
  before.roles.roles[3] = { original: aid(10), callable: aid(11), marker: { name: `${aid(11)}::market::MarketRevision1` }, version: '2', pinned: true, frozen: variant === 'role-frozen' }
  if (variant === 'config-callable') before.callable_package = aid(99)
  if (variant === 'config-schema') before.schema = 2
  if (variant === 'config-release') before.minimum_release = '3'
  if (variant === 'role-unpinned') before.roles.roles[3].pinned = false
  if (variant === 'role-version') before.roles.roles[3].version = '3'
  if (variant === 'role-original') before.roles.roles[3].original = aid(99)
  if (variant === 'role-marker') before.roles.roles[3].marker = { name: `${aid(10)}::market::MarketRevision1` }
  before.commitment = economicsOperationalSnapshotHash({ domain: new TextEncoder().encode('soulidity-protocol-operational-v4'), config: economicsConfigSnapshot(before), gates: { primary: true, secondary: true } })
  const withCollection = variant.startsWith('collection'), multi = variant === 'multi' || variant === 'merge-disposition', buyer = buyerAddress ?? f.sender, seller = aid(70)
  const creator = variant === 'creator-seller' ? seller : variant === 'creator-buyer' ? buyer : aid(71), collectionHolder = aid(72)
  const coinType = normalizeStructTag(before.payment_coin.name), quote = quoteNativeSale(101n, { secondaryBps: before.secondary_bps, creatorBps: 250, collectionBps: withCollection ? 500 : 0 })
  const distribution = nativeSaleDistribution(quote, { seller, creator, collection: withCollection ? collectionHolder : seller })
  const rows = new Map<string, any>(), changes: any[] = [], history = withCollection ? await batchHistoryFixture(0) : null
  const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
  function object(id: string, type: string, contents: Uint8Array, owner: any, version: number) {
    const previousTransaction = version === 10 ? f.ledger.digest : adigest(9)
    const bytes = bcs.Object.serialize({ data: { Move: { type: { Other: TypeTagSerializer.parseFromStr(type).struct! }, hasPublicTransfer: true, version, contents } },
      owner, previousTransaction, storageRebate: 0 }).toBytes(), raw = bcs.Object.parse(bytes)
    const row = { objectId: id, version: BigInt(version), digest: activityHash('Object', bytes), bcs: { value: bytes }, objectType: normalizeStructTag(type), contents: { value: contents }, previousTransaction,
      owner: owner.AddressOwner ? { kind: 1, address: owner.AddressOwner } : owner.ObjectOwner ? { kind: 2, address: owner.ObjectOwner } : { kind: 3, version: 1n } }
    rows.set(`${id}:${version}`, row); return { row, owner: raw.owner }
  }
  function effect(id: string, input: ReturnType<typeof object> | null, output: ReturnType<typeof object> | null) {
    changes.push([id, { inputState: input ? { Exist: [[String(input.row.version), input.row.digest], input.owner] } : { NotExist: true },
      outputState: output ? { ObjectWrite: [output.row.digest, output.owner] } : { NotExist: true },
      idOperation: !input ? { Created: true } : !output ? { Deleted: true } : { None: true } }])
  }
  const paymentType = `0x2::coin::Coin<${coinType}>`, gasType = '0x2::coin::Coin<0x2::sui::SUI>'
  const first = object(aid(30), paymentType, Coin.serialize({ id: aid(30), balance: 1000 }).toBytes(), { AddressOwner: buyer }, 9)
  const second = multi ? object(aid(31), paymentType, Coin.serialize({ id: aid(31), balance: 500 }).toBytes(), { AddressOwner: buyer }, 9) : null
  const gasInput = object(aid(40), gasType, Coin.serialize({ id: aid(40), balance: 2000 }).toBytes(), { AddressOwner: buyer }, 2)
  const p: NativeSaleGraphPlan = { schema: 'soulidity.native-sale-graph.v1', buyer, callablePackageId: native.callablePackageId, coinType,
    soulId: aid(60), offerId: aid(61), registryId: aid(62), configId: before.id, policyId: aid(63), sellerKioskId: aid(64), buyerKioskId: aid(65),
    collectionId: withCollection ? aid(66) : null, buyerAccount: buyerAccount ?? { objectId: aid(67), version: '9', digest: adigest(67) }, generation: '0', attemptHex: '01'.repeat(32),
    quoteExpiryMs: '1000', reviewedTotal: String(quote.total), paymentCoins: [
      { objectId: aid(30), version: '9', digest: first.row.digest, balance: '1000' },
      ...(second ? [{ objectId: aid(31), version: '9', digest: second.row.digest, balance: '500' }] : [])],
    shared: [{ objectId: aid(61), mutable: true }, { objectId: aid(62), mutable: false }, { objectId: before.id, mutable: true },
      { objectId: aid(63), mutable: false }, { objectId: aid(64), mutable: true }, { objectId: aid(65), mutable: true }, { objectId: `0x${'6'.padStart(64, '0')}`, mutable: false },
      ...(withCollection ? [{ objectId: aid(66), mutable: false }] : [])].map(row => ({ ...row, initialSharedVersion: variant === 'shared-birth' && row.objectId === before.id ? '2' : '1' })),
    expirationEpoch: '6', gas: { budget: '1000', price: '1', coins: [{ objectId: aid(40), version: '2', digest: gasInput.row.digest }] } }
  const txBytes = await buildNativeSaleGraph(p).build(); Object.assign(f.transactionData.V1, bcs.TransactionData.parse(txBytes).V1); f.rehashTransaction()
  const offer = { id: p.offerId, root: p.soulId, state: aid(68), registry: p.registryId, config: p.configId, config_revision: before.revision, policy: p.policyId,
    seller, kiosk: p.sellerKioskId, creator, royalty: 250, generation: 0, root_revision: 1, manifest: new Uint8Array(32), collection: p.collectionId,
    ask: 101, active: true, purchase: { id: aid(69), kiosk_id: p.sellerKioskId, item_id: p.soulId, min_price: 0 } }
  const offerType = `${native.originalPackageId}::market::Offer`
  effect(p.offerId, object(p.offerId, offerType, NativeOfferBcs.serialize(offer).toBytes(), { Shared: { initialSharedVersion: 1 } }, 9),
    object(p.offerId, offerType, NativeOfferBcs.serialize({ ...offer, active: variant === 'offer-active',
      purchase: variant === 'offer-cap' ? offer.purchase : null, seller: variant === 'offer-seller' ? aid(99) : seller }).toBytes(), { Shared: { initialSharedVersion: 1 } }, 10))
  changes.push([offer.purchase.id, { inputState: { NotExist: true }, outputState: { NotExist: true }, idOperation: { Deleted: true } }])
  const listingKey = bcs.struct('Listing', { id: bcs.Address, is_exclusive: bcs.bool() })
  const listingId = deriveDynamicFieldID(p.sellerKioskId, '0x2::kiosk::Listing', listingKey.serialize({ id: p.soulId, is_exclusive: true }).toBytes())
  const listingType = '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>'
  const listingBytes = NativeExclusiveListingFieldBcs.serialize({ id: listingId, name: { id: p.soulId, is_exclusive: variant !== 'listing-key' },
    value: variant === 'listing-price' ? 1 : 0 }).toBytes()
  effect(listingId, object(listingId, listingType, listingBytes, { ObjectOwner: variant === 'listing-owner' ? aid(99) : p.sellerKioskId }, 9),
    variant === 'listing-retained' ? object(listingId, listingType, listingBytes, { ObjectOwner: p.sellerKioskId }, 10) : null)
  const after = structuredClone(before); after.income.funds = String(BigInt(before.income.funds) + quote.platform - (variant === 'ledger' ? 1n : 0n))
  after.income.collected = String(BigInt(before.income.collected) + quote.platform); after.income.revision = String(BigInt(before.income.revision) + 1n)
  const configType = `${foundation.deployment.originalPackageId}::economics::Config<${coinType}>`
  effect(p.configId, object(p.configId, configType, EconomicsConfigBcs.serialize(before).toBytes(), { Shared: { initialSharedVersion: 1 } }, 9),
    object(p.configId, configType, EconomicsConfigBcs.serialize(after).toBytes(), { Shared: { initialSharedVersion: 1 } }, 10))
  const inputBalance = 1000n + (multi ? 500n : 0n)
  effect(aid(30), first, object(aid(30), paymentType, Coin.serialize({ id: aid(30), balance: inputBalance - quote.total }).toBytes(), { AddressOwner: buyer }, 10))
  if (second) effect(aid(31), second, variant === 'merge-disposition' ? object(aid(31), paymentType, Coin.serialize({ id: aid(31), balance: 500 }).toBytes(), { AddressOwner: buyer }, 10) : null)
  const slots = [{ owner: seller, amount: distribution.sellerTransfer }, ...(distribution.creatorTransfer ? [{ owner: creator, amount: distribution.creatorTransfer }] : []),
    ...(distribution.collectionTransfer ? [{ owner: collectionHolder, amount: distribution.collectionTransfer }] : [])]
  slots.forEach((slot, index) => { const id = aid(90 + index)
    effect(id, null, object(id, paymentType, Coin.serialize({ id, balance: slot.amount - (variant === 'payout' && index === 0 ? 1n : 0n) }).toBytes(),
      { AddressOwner: variant === 'recipient' && index === 0 ? aid(99) : slot.owner }, 10)) })
  const gasIndex = changes.length
  effect(aid(40), gasInput, object(aid(40), gasType, Coin.serialize({ id: aid(40), balance: variant === 'gas' ? 1998 : 1997 }).toBytes(), { AddressOwner: buyer }, 10))
  if (withCollection) {
    const c = { id: p.collectionId!, schema_version: 1, protocol: p.configId, creator: variant === 'collection-creator' ? aid(99) : creator, right: aid(76), right_hash: new Uint8Array(32), policy: aid(77),
      extra: 500, tradeable: true, max_supply: null, floor: null, supply: 1, members: { id: aid(78), size: 1 }, revision: 1, holder: collectionHolder, kiosk: aid(79), epoch: 0 }
    const row = history!.base.object(c.id, 9, `${collection.deployment.originalPackageId}::collection::Collection`, SaleCollectionBcs.serialize(c).toBytes(), { Shared: { initialSharedVersion: 1 } }, history!.register.digest)
    rows.set(`${c.id}:9`, row)
    const memberId = deriveDynamicFieldID(c.members.id, '0x2::object::ID', bcs.Address.serialize(p.soulId).toBytes())
    const member = history!.base.object(memberId, 9, '0x2::dynamic_field::Field<0x2::object::ID,u64>', SaleCollectionMemberBcs.serialize({ id: memberId, name: variant === 'collection-key' ? aid(99) : p.soulId, value: variant === 'collection-ordinal' ? 2 : 1 }).toBytes(), { ObjectOwner: variant === 'collection-owner' ? aid(99) : c.members.id }, history!.register.digest)
    history!.ledgers.get(history!.register.digest)!.effects = history!.base.effects(history!.register.digest, 9, [row, ...(variant === 'collection-missing' ? [] : [member])].map(r => history!.base.change(r, true)))
    history!.base.object(memberId, 10, '0x2::dynamic_field::Field<0x2::object::ID,u64>', SaleCollectionMemberBcs.serialize({ id: memberId, name: aid(99), value: 99 }).toBytes(), { ObjectOwner: aid(99) }, adigest(99))
    f.effectsData.V2!.unchangedConsensusObjects = [[c.id, { $kind: 'ReadOnlyRoot', ReadOnlyRoot: ['9', row.digest] }]]
  }
  f.effectsData.V2!.changedObjects = changes; f.effectsData.V2!.gasObjectIndex = gasIndex; f.rehashEffects()
  const effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(f.effectsData).toBytes())
  f.client.ledgerService.getObject.mockImplementation(async (request: any, options: any) => {
    const { objectId, version } = request
    if (history && version !== undefined && !rows.has(`${objectId}:${version}`)) return history.transport.ledgerService.getObject(request, options)
    return { response: { object: version !== undefined ? rows.get(`${objectId}:${version}`)
      : objectId === foundation.pkg.objectId ? foundation.pkg : objectId === collection.pkg.objectId ? collection.pkg : f.pkg } }
  })
  if (history) {
    const originalTransaction = f.client.ledgerService.getTransaction.getMockImplementation()!, originalCheckpoint = f.client.ledgerService.getCheckpoint.getMockImplementation()!
    f.client.ledgerService.getTransaction.mockImplementation((request: any, options: any) => request.digest === f.ledger.digest ? originalTransaction(request, options) : history.transport.ledgerService.getTransaction(request, options))
    f.client.ledgerService.getCheckpoint.mockImplementation((request: any, options: any) => String(request.checkpointId?.sequenceNumber) === '100' ? originalCheckpoint(request, options) : history.transport.ledgerService.getCheckpoint(request, options))
  }
  return { f, offer, quote, collectionHolder, object, effect, changes, params: { client: f.client as any, plan: p, packet: { bytes: toBase64(txBytes), digest: f.ledger.digest }, effects,
    native, foundation: foundation.deployment, ...(withCollection ? { collection: collection.deployment } : {}), signal: new AbortController().signal } }
}
