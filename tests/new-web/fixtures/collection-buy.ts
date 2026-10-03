import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { SoulPublicCollectionBcs, SoulPublicCollectionRightBcs, SoulPublicKioskBcs, SoulPublicMarketConfigBcs,
  CollectionPublicListingBcs, CollectionKioskRegistryBcs, CollectionKioskRegistrationFieldBcs, CollectionPersonalKioskCapBcs,
  CollectionKioskListingFieldBcs, deriveKioskItemFieldId, KioskItemFieldBcs } from '@soulidity/sdk'
import { collectionCommandHash, collectionCommandRegistration, collectionCommandMarker } from '../../../web/lib/collections/collection-command-plan'
import { collectionBuyTypes, collectionBuyOwnerMarker, collectionBuyLock, collectionBuyRuleIds,
  CollectionBuyPolicyBcs, CollectionBuyOwnerMarkerBcs, CollectionBuyLockBcs, CollectionBuyRuleEmptyBcs, CollectionBuyRuleBoolBcs,
  CollectionBuyCoinBcs as Coin, type CollectionBuyRecord } from '../../../web/lib/collections/collection-buy-plan'
import { prepareCollectionBuyPlan } from '../../../web/lib/collections/collection-buy-state'
import { buildCollectionBuyTransaction, createCollectionBuyAdapter } from '../../../web/lib/collections/collection-buy-operation'
import { CollectionBuyPurchasedBcs, CollectionBuyRegistrationEventBcs } from '../../../web/lib/collections/collection-buy-history'
import { ActivityFixtureEventsBcs } from './activity-transaction-evidence'
import { collectionCommandFixture, cid } from './collection-command'

export { cid }
type Codec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
type Owner = Parameters<typeof bcs.Owner.serialize>[0]
const shared = { Shared: { initialSharedVersion: '1' } }

/** Controlled ledger with real full Object/transaction/effects/checkpoint BCS,
 * real SDK-built PTBs and signatures. This fixture does not execute the VM. */
export async function collectionBuyFixture(options: { newKiosk?: boolean; feeBps?: number; price?: string;
  paymentBalances?: string[]; gasBalances?: string[]; sellerLocked?: boolean; feeRecipientSeller?: boolean } = {}) {
  const f = await collectionCommandFixture('delist'), { current, rows, objects } = f
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(53)), author = signer.toSuiAddress()
  const target = { ...f.target, kioskPackageId: cid(1001), collectionTransferPolicyId: cid(1002) }, types = collectionBuyTypes(target)
  function full(...args: Parameters<typeof f.full>) {
    const row = f.full(...args)
    if (args[1] === types.coin) {
      const raw = bcs.Object.parse(row.bcs.value)
      raw.data.Move!.type = { $kind: 'Coin', Coin: target.paymentCoinType }; raw.data.Move!.hasPublicTransfer = true
      row.bcs.value = bcs.Object.serialize(raw).toBytes(); row.digest = collectionCommandHash('Object', row.bcs.value)
      objects.set(`${row.objectId}:${row.version}`, raw)
    }
    return row
  }
  const c = { ...f.c }, right = { ...f.right }, sellerKiosk = { ...f.kiosk }, listing = { ...f.listing, price: options.price ?? '1000001' }
  const registry = { ...f.registry }, market = { ...f.market, platform_fee_bps: options.feeBps ?? 50, fee_recipient: options.feeRecipientSeller ? f.author : f.market.fee_recipient }
  const buyerKiosk = { id: cid(options.newKiosk ? 1201 : 1101), profits: '0', owner: author, item_count: 0, allow_extensions: true }
  const cap = { id: cid(options.newKiosk ? 1202 : 1102), cap: { id: cid(options.newKiosk ? 1203 : 1103), for: buyerKiosk.id } }
  const regId = collectionCommandRegistration(target, author), reg = { id: regId, name: { owner: author }, value: { version: '1', kiosk_id: buyerKiosk.id, kiosk_cap_id: cap.id } }
  function packageRow(objectId: string, raw: ReturnType<typeof bcs.Object.parse>) {
    const bytes = bcs.Object.serialize(raw).toBytes(), digest = collectionCommandHash('Object', bytes)
    const row = { objectId, version: BigInt(raw.data.Package!.version), digest, owner: { kind: 4 }, previousTransaction: raw.previousTransaction, bcs: { value: bytes } }
    current.set(objectId, row); rows.set(`${objectId}:${row.version}`, row); return row
  }
  const native = bcs.Object.parse(current.get(target.callablePackageId).bcs.value)
  for (const name of ['CollectionPurchased', 'PersonalKioskRegistrationUpdated', 'CollectionMarketProof']) native.data.Package!.typeOriginTable.push({ moduleName: 'market', datatypeName: name, package: target.originalPackageId })
  native.data.Package!.linkageTable.set(target.personalKioskTypePackageId, { upgradedId: target.kioskPackageId, upgradedVersion: '1' })
  target.callableDigest = packageRow(target.callablePackageId, native).digest
  const kioskOrigins = [['personal_kiosk', 'PersonalKioskCap'], ['personal_kiosk', 'OwnerMarker'], ['personal_kiosk', 'NewPersonalKiosk'], ['kiosk_lock_rule', 'Rule'], ['kiosk_lock_rule', 'Config'], ['personal_kiosk_rule', 'Rule'], ['witness_rule', 'Rule']]
  packageRow(target.kioskPackageId, bcs.Object.parse(bcs.Object.serialize({ data: { Package: { id: target.kioskPackageId, version: '1',
    moduleMap: new Map(kioskOrigins.map(([module]) => [module, new Uint8Array([1])])), linkageTable: new Map(),
    typeOriginTable: kioskOrigins.map(([moduleName, datatypeName]) => ({ moduleName, datatypeName, package: target.personalKioskTypePackageId })) } },
    owner: { Immutable: true }, previousTransaction: native.previousTransaction, storageRebate: '0' }).toBytes()))
  full(listing.id, types.listing, CollectionPublicListingBcs, listing, shared)
  full(market.id, types.market, SoulPublicMarketConfigBcs, market, shared)
  const markerValue = (kioskId: string, owner: string) => ({ id: collectionBuyOwnerMarker(target, kioskId), name: { dummy_field: false }, value: owner })
  const sellerMarker = markerValue(sellerKiosk.id, f.author), buyerMarker = markerValue(buyerKiosk.id, author)
  full(sellerMarker.id, types.ownerMarker, CollectionBuyOwnerMarkerBcs, sellerMarker, { ObjectOwner: sellerKiosk.id })
  const sourceLockId = collectionBuyLock(sellerKiosk.id, right.id), sourceLock = { id: sourceLockId, name: { id: right.id }, value: true }
  if (options.sellerLocked) full(sourceLockId, types.lock, CollectionBuyLockBcs, sourceLock, { ObjectOwner: sellerKiosk.id })
  if (!options.newKiosk) {
    full(buyerKiosk.id, types.kiosk, SoulPublicKioskBcs, buyerKiosk, shared)
    full(cap.id, types.cap, CollectionPersonalKioskCapBcs, cap, { AddressOwner: author })
    full(regId, types.registration, CollectionKioskRegistrationFieldBcs, reg, { ObjectOwner: registry.id })
    full(buyerMarker.id, types.ownerMarker, CollectionBuyOwnerMarkerBcs, buyerMarker, { ObjectOwner: buyerKiosk.id })
  }
  const policy = { id: target.collectionTransferPolicyId, balance: '0', rules: { contents: types.rules.map(name => ({ name: name.slice(2) })) } }
  full(policy.id, types.policy, CollectionBuyPolicyBcs, policy, shared)
  collectionBuyRuleIds(target).forEach((ruleId, index) => {
    full(ruleId, types.ruleFields[index], index === 0 ? CollectionBuyRuleEmptyBcs : CollectionBuyRuleBoolBcs,
      { id: ruleId, name: { dummy_field: false }, value: index === 0 ? { dummy_field: false } : true }, { ObjectOwner: policy.id })
  })
  const balances = options.paymentBalances ?? ['900000', '200000'], paymentCoinObjectIds = balances.map((_, index) => cid(1300 + index))
  balances.forEach((balance, index) => full(paymentCoinObjectIds[index], types.coin, Coin, { id: paymentCoinObjectIds[index], balance }, { AddressOwner: author }))
  const gasBalances = options.gasBalances ?? ['10000000'], gasRows = gasBalances.map((balance, index) => {
    const objectId = cid(900 + index)
    return full(objectId, '0x2::coin::Coin<0x2::sui::SUI>', Coin, { id: objectId, balance }, { AddressOwner: author })
  })
  const resolve = vi.fn(async (data: TransactionDataBuilder, _options: unknown, next: () => Promise<void>) => {
    data.inputs = data.inputs.map(input => input.UnresolvedObject ? Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId,
      initialSharedVersion: '1', mutable: [c.id, sellerKiosk.id, buyerKiosk.id, registry.id, listing.id].includes(input.UnresolvedObject.objectId) }) : input)
    data.gasData = { owner: author, budget: '1000000', price: '1', payment: gasRows.map(row => ({ objectId: row.objectId, version: '11', digest: row.digest })) }; await next()
  })
  const client = { ...f.client, core: { ...f.client.core, resolveTransactionPlugin: () => resolve }, stateService: {
    listOwnedObjects: vi.fn(async () => ({ response: { objects: paymentCoinObjectIds.map(objectId => ({ objectId })) } })) } }
  const params = { client: client as never, target, author, request: { collectionId: c.id, listingId: listing.id }, paymentCoinObjectIds }
  const plan = await prepareCollectionBuyPlan(params)
  async function packet(mutate?: (data: TransactionDataBuilder) => void): Promise<CollectionBuyRecord> {
    const tx = buildCollectionBuyTransaction(plan); tx.setSender(author); tx.setExpiration({ Epoch: '10' })
    const bytes = await tx.build({ client: client as never }), data = new TransactionDataBuilder(Transaction.from(bytes).getData()); mutate?.(data)
    const exact = data.build(), signed = await signer.signTransaction(exact)
    return { schema: 'soulidity.collection-buy.v1', plan: structuredClone(plan), packet: { bytes: toBase64(exact), digest: TransactionDataBuilder.getDigestFromBytes(exact), expirationEpoch: '10', phase: 'SIGNED', signature: signed.signature } }
  }
  const record = await packet(), evidence = f.evidence
  evidence.transactionData.V1 = bcs.TransactionData.parse(fromBase64(record.packet.bytes)).V1
  const effects = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: { status: { Success: true }, executedEpoch: '9',
    gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' }, transactionDigest: record.packet.digest,
    gasObjectIndex: 0, eventsDigest: null, dependencies: [], lamportVersion: '12', changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null } }).toBytes())
  function transition(objectId: string, type: string, codec: Codec, before: any | null, after: any | null, owner: Owner, readonly = false, afterOwner?: Owner) {
    const input = before === null ? null : full(objectId, type, codec, before, owner)
    if (readonly) { effects.V2!.unchangedConsensusObjects.push([objectId, { $kind: 'ReadOnlyRoot', ReadOnlyRoot: ['11', input!.digest] }]); return }
    const output = after === null ? null : full(objectId, type, codec, after,
      afterOwner ?? (before === null && 'Shared' in owner ? { Shared: { initialSharedVersion: '12' } } : owner), '12', record.packet.digest)
    const ownerOf = (row: any) => bcs.Object.parse(row.bcs.value).owner
    effects.V2!.changedObjects.push([objectId, { inputState: input ? { $kind: 'Exist', Exist: [['11', input.digest], ownerOf(input)] } : { $kind: 'NotExist', NotExist: true },
      outputState: output ? { $kind: 'ObjectWrite', ObjectWrite: [output.digest, ownerOf(output)] } : { $kind: 'NotExist', NotExist: true },
      idOperation: !output ? { $kind: 'Deleted', Deleted: true } : !input ? { $kind: 'Created', Created: true } : { $kind: 'None', None: true } }])
  }
  const totalGas = gasBalances.reduce((sum, balance) => sum + BigInt(balance), 0n)
  gasRows.forEach((row, index) => transition(row.objectId, '0x2::coin::Coin<0x2::sui::SUI>', Coin, { id: row.objectId, balance: gasBalances[index] },
    index === 0 ? { id: row.objectId, balance: String(totalGas - 1n) } : null, { AddressOwner: author }))
  transition(c.id, types.collection, SoulPublicCollectionBcs, c, { ...c, current_holder: author, current_holder_kiosk_id: buyerKiosk.id }, shared)
  transition(sellerKiosk.id, types.kiosk, SoulPublicKioskBcs, sellerKiosk, { ...sellerKiosk, item_count: 0 }, shared)
  transition(buyerKiosk.id, types.kiosk, SoulPublicKioskBcs, options.newKiosk ? null : buyerKiosk, { ...buyerKiosk, item_count: 1 }, shared)
  transition(registry.id, types.registry, CollectionKioskRegistryBcs, registry, registry, shared)
  transition(market.id, types.market, SoulPublicMarketConfigBcs, market, market, shared, true)
  transition(policy.id, types.policy, CollectionBuyPolicyBcs, policy, policy, shared, true)
  transition(listing.id, types.listing, CollectionPublicListingBcs, listing, { ...listing, is_active: false, purchase_cap: null }, shared)
  effects.V2!.changedObjects.push([listing.purchase_cap.id, { inputState: { $kind: 'NotExist', NotExist: true },
    outputState: { $kind: 'NotExist', NotExist: true }, idOperation: { $kind: 'Deleted', Deleted: true } }])
  if (options.newKiosk) {
    transition(cap.id, types.cap, CollectionPersonalKioskCapBcs, null, cap, { AddressOwner: author })
    transition(regId, types.registration, CollectionKioskRegistrationFieldBcs, null, reg, { ObjectOwner: registry.id })
    transition(buyerMarker.id, types.ownerMarker, CollectionBuyOwnerMarkerBcs, null, buyerMarker, { ObjectOwner: buyerKiosk.id })
    effects.V2!.changedObjects.push([cap.cap.id, { inputState: { $kind: 'NotExist', NotExist: true },
      outputState: { $kind: 'NotExist', NotExist: true }, idOperation: { $kind: 'Created', Created: true } }])
  }
  const markerId = collectionCommandMarker(sellerKiosk.id, right.id, true), marker = { id: markerId, name: { id: right.id, is_exclusive: true }, value: '0' }
  transition(markerId, types.marker, CollectionKioskListingFieldBcs, marker, null, { ObjectOwner: sellerKiosk.id })
  const itemId = deriveKioskItemFieldId(sellerKiosk.id, right.id), destinationItemId = deriveKioskItemFieldId(buyerKiosk.id, right.id)
  transition(itemId, types.item, KioskItemFieldBcs, { id: itemId, name: { name: { id: right.id } }, value: right.id }, null, { ObjectOwner: sellerKiosk.id })
  transition(destinationItemId, types.item, KioskItemFieldBcs, null, { id: destinationItemId, name: { name: { id: right.id } }, value: right.id }, { ObjectOwner: buyerKiosk.id })
  transition(right.id, types.right, SoulPublicCollectionRightBcs, right, right, { ObjectOwner: itemId }, false, { ObjectOwner: destinationItemId })
  if (options.sellerLocked) transition(sourceLockId, types.lock, CollectionBuyLockBcs, sourceLock, null, { ObjectOwner: sellerKiosk.id })
  const destinationLockId = collectionBuyLock(buyerKiosk.id, right.id)
  transition(destinationLockId, types.lock, CollectionBuyLockBcs, null, { id: destinationLockId, name: { id: right.id }, value: true }, { ObjectOwner: buyerKiosk.id })
  const sum = balances.reduce((sum, value) => sum + BigInt(value), 0n)
  balances.forEach((balance, index) => transition(paymentCoinObjectIds[index], types.coin, Coin, { id: paymentCoinObjectIds[index], balance },
    index === 0 ? { id: paymentCoinObjectIds[index], balance: String(sum - BigInt(plan.quote.buyerTotalAtomic)) } : null, { AddressOwner: author }))
  transition(cid(1400), types.coin, Coin, null, { id: cid(1400), balance: plan.quote.priceAtomic }, { AddressOwner: f.author })
  if (BigInt(plan.quote.feeAtomic) > 0n) transition(cid(1401), types.coin, Coin, null, { id: cid(1401), balance: plan.quote.feeAtomic }, { AddressOwner: market.fee_recipient })
  const event = (name: string, contents: Uint8Array, kiosk = false) => ({ package_id: kiosk ? target.kioskPackageId : target.callablePackageId,
    transaction_module: kiosk ? 'personal_kiosk' : 'market', sender: author,
    type_: { address: kiosk ? target.personalKioskTypePackageId : target.originalPackageId, module: kiosk ? 'personal_kiosk' : 'market', name, typeParams: [] }, contents })
  evidence.eventsData.data = ActivityFixtureEventsBcs.parse(ActivityFixtureEventsBcs.serialize({ data: [
    ...(options.newKiosk ? [event('NewPersonalKiosk', bcs.struct('NewPersonalKiosk', { kiosk_id: bcs.Address }).serialize({ kiosk_id: buyerKiosk.id }).toBytes(), true),
      event('PersonalKioskRegistrationUpdated', CollectionBuyRegistrationEventBcs.serialize({ kiosk_id: buyerKiosk.id, kiosk_cap_id: cap.id, owner: author }).toBytes())] : []),
    event('CollectionPurchased', CollectionBuyPurchasedBcs.serialize({ listing_id: listing.id, collection_id: c.id, right_id: right.id,
      seller: f.author, buyer: author, price: plan.quote.priceAtomic, platform_fee: plan.quote.feeAtomic }).toBytes()),
  ] }).toBytes()).data
  evidence.effectsData.V2 = effects.V2; evidence.summaryData.epoch = '9'; evidence.summaryData.sequence_number = '42'
  if (evidence.contentsData.V1) evidence.contentsData.V1.user_signatures[1] = [fromBase64(record.packet.signature!)]
  else evidence.contentsData.V2!.transactions[1].user_signatures = [[fromBase64(record.packet.signature!), null]]
  evidence.rehashTransaction()
  client.ledgerService.getCheckpoint.mockImplementation(evidence.client.ledgerService.getCheckpoint)
  client.ledgerService.getTransaction.mockImplementation(async () => ({ response: { transaction: structuredClone(evidence.ledger) } }))
  let address: string | null = author
  const getAddress = vi.fn(() => address), read = vi.fn(async () => {}), sign = vi.fn(async (tx: Transaction) => signer.signTransaction(await tx.build()))
  const adapter = createCollectionBuyAdapter({ client: client as never, getAddress, read, sign })
  return { params, client, target, author, signer, c, right, sellerKiosk, buyerKiosk, registry, market, listing, cap, regId, itemId,
    destinationItemId, sourceLockId, destinationLockId, markerId, policy, types, current, rows, objects, full, editCurrent: f.editCurrent,
    plan, record, packet, effects, evidence, adapter, sign, read, getAddress, resolve, paymentCoinObjectIds,
    setAddress: (next: string | null) => { address = next } }
}
