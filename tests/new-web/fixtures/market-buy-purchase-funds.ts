import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { UnaryCall } from '@protobuf-ts/runtime-rpc'
import { deriveKioskItemFieldId, quoteAnimacraftV8SoulSale } from '@soulidity/sdk'
import { vi } from 'vitest'
import { queryMarketBuyPurchaseFunds } from '../../../web/lib/animacraft/market-buy-purchase-funds'
import { buildMarketBuyOperationTransaction } from '../../../web/lib/animacraft/market-buy-operation'
import { NativeMarketConfigBcs, NativeMarketListingBcs } from '../../../web/lib/animacraft/native-market'
import { NativeCancelKioskBcs, NativeCancelPersonalKioskCapBcs } from '../../../web/lib/animacraft/native-market-cancel-snapshot'
import { activityEvidenceFixture, activityHash, adigest, ActivityFixtureEventsBcs } from './activity-transaction-evidence'
import { marketBuyFixture, marketBuyEventEvidence, bid, buyCoinBcs } from './market-buy-operation'
import { browserNativeMarketReadbackFixture } from './browser-native-market-readback'
import { NativeSoulStateBcs } from '../../../web/lib/animacraft/native-receive'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { equipmentAddressGasEffect } from './equipment-market-evidence'

const kioskFamily = '0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879'
const sui = '0x2::coin::Coin<0x2::sui::SUI>'
const zero = bid(0)

export async function marketBuyPurchaseFundsFixture(options: { newKiosk?: boolean; sameRoles?: boolean; tiny?: boolean; legacy?: boolean; exact?: boolean; buyerRecipient?: boolean; handoff?: boolean; addressGas?: boolean } = {}) {
  const buy = await marketBuyFixture({ newKiosk: options.newKiosk, balances: options.exact ? ['1000000'] : undefined })
  const chain = await activityEvidenceFixture({ effectsVersion: options.legacy ? 1 : 2 })
  const kioskPkg = await activityEvidenceFixture()
  const handoff = options.handoff ? await browserNativeMarketReadbackFixture('buy') : null
  const outputPkg = handoff ? await activityEvidenceFixture() : null
  const s = buy.record.snapshot
  if (handoff) {
    s.release.soulidityOriginalPackageId = handoff.target.soulidityOriginalPackageId
    s.release.marketConfigV2Id = bid(206)
  }
  if (options.sameRoles) s.creator = s.protocolFeeRecipient = s.makerCreator = s.seller
  if (options.tiny) s.priceAtomic = '1'
  if (options.buyerRecipient) s.protocolFeeRecipient = s.buyer
  const native = chain.packageData.data.Package!
  native.id = s.release.soulidityCallablePackageId
  chain.deployment.originalPackageId = s.release.soulidityOriginalPackageId
  native.moduleMap = new Map([['market', new Uint8Array([1])]])
  native.typeOriginTable = ['SoulListing', 'MarketConfigV2', 'AnimacraftV8SoulPurchased']
    .map(datatypeName => ({ moduleName: 'market', datatypeName, package: s.release.soulidityOriginalPackageId }))
  native.linkageTable.set(kioskFamily, { upgradedId: s.release.kioskPackageId, upgradedVersion: '2' })
  if (handoff && outputPkg) {
    const target = handoff.target
    const copyPackage = (row: any, data: typeof native) => {
      data.id = row.objectId
      data.moduleMap = new Map(row.package.modules.map((entry: any) => [entry.name, entry.contents]))
      data.typeOriginTable = row.package.typeOrigins.map(({ moduleName, datatypeName, packageId }: any) => ({ moduleName, datatypeName, package: packageId }))
    }
    copyPackage(handoff.objects.get(target.soulidityCallablePackageId), native)
    copyPackage(handoff.objects.get(target.outputCallablePackageId), outputPkg.packageData.data.Package!)
    outputPkg.deployment.originalPackageId = target.outputOriginalPackageId
    outputPkg.rehashPackage()
    native.linkageTable.set(target.outputOriginalPackageId, { upgradedId: target.outputCallablePackageId, upgradedVersion: '2' })
    target.outputCallableDigest = outputPkg.pkg.digest
  }
  chain.rehashPackage()
  s.release.soulidityCallableDigest = chain.pkg.digest
  if (handoff) handoff.target.soulidityCallableDigest = chain.pkg.digest
  const kp = kioskPkg.packageData.data.Package!
  kp.id = s.release.kioskPackageId
  kioskPkg.deployment.originalPackageId = kioskFamily
  kp.moduleMap = new Map([['personal_kiosk', new Uint8Array([2])]])
  kp.typeOriginTable = [{ moduleName: 'personal_kiosk', datatypeName: 'PersonalKioskCap', package: kioskFamily }]
  kioskPkg.rehashPackage()

  type Owner = { AddressOwner: string } | { Shared: { initialSharedVersion: string } } | { ObjectOwner: string } | { Immutable: true }
  type ObjectRow = { objectId: string; version: bigint; digest: string; owner: { kind: number; address?: string; version?: bigint };
    bcs: { value: Uint8Array }; contents: { value: Uint8Array }; previousTransaction: string; objectType: string }
  const objects = new Map<string, ObjectRow>()
  const latest = new Map<string, ObjectRow>(), missingLatest = new Set<string>()
  function move(id: string, type: string, version: number, owner: Owner, contents: Uint8Array) {
    const previousTransaction = version === 10 ? buy.record.digest : adigest(14)
    const raw = bcs.Object.serialize({ data: { Move: {
      type: type === sui ? { GasCoin: true } : { Other: TypeTagSerializer.parseFromStr(type).struct! },
      version, hasPublicTransfer: true, contents,
    } }, owner, previousTransaction, storageRebate: '0' }).toBytes()
    const row: ObjectRow = { objectId: id, version: BigInt(version), digest: activityHash('Object', raw),
      owner: 'AddressOwner' in owner ? { kind: 1, address: owner.AddressOwner }
        : 'Shared' in owner ? { kind: 3, version: BigInt(owner.Shared.initialSharedVersion) }
        : 'ObjectOwner' in owner ? { kind: 2, address: owner.ObjectOwner } : { kind: 4 },
      bcs: { value: raw }, contents: { value: contents }, previousTransaction, objectType: normalizeStructTag(type) }
    objects.set(`${id}:${version}`, row)
    return row
  }
  const paymentType = `0x2::coin::Coin<${s.release.paymentCoinType}>`
  const buyer = { AddressOwner: s.buyer }, shared = { Shared: { initialSharedVersion: '1' } }
  const coin = (id: string, balance: bigint | string, owner: string, version: number, type = paymentType) =>
    move(id, type, version, { AddressOwner: owner }, buyCoinBcs.serialize({ id, balance }).toBytes())
  const gasId = bid(200), gasStart = coin(gasId, '2000000', s.buyer, 1, sui)
  for (const c of buy.record.paymentCoins) c.digest = coin(c.objectId, c.balanceAtomic, s.buyer, 2).digest
  const original = buy.tx.getData(), builder = buildMarketBuyOperationTransaction(buy.record).getData()
  const tx = Transaction.from(JSON.stringify({
    ...original, commands: builder.commands,
    gasData: { ...original.gasData, payment: options.addressGas ? [] : [{ objectId: gasId, version: '1', digest: gasStart.digest }] },
    inputs: builder.inputs.map((row, i) => {
      if (row.Pure) return row
      const payment = buy.record.paymentCoins.find(c => c.objectId === row.UnresolvedObject?.objectId)
      if (handoff && row.UnresolvedObject?.objectId === s.release.marketConfigV2Id) {
        return { Object: { SharedObject: { objectId: s.release.marketConfigV2Id, initialSharedVersion: '1', mutable: false } } }
      }
      return payment ? { Object: { ImmOrOwnedObject: { objectId: payment.objectId, version: payment.version, digest: payment.digest } } } : original.inputs[i]
    }),
  }))
  if (options.addressGas) {
    buy.record.expirationEpoch = '6'
    tx.setExpiration({ ValidDuring: { chain: MAINNET_GENESIS_DIGEST, minEpoch: '5', maxEpoch: '6',
      minTimestamp: null, maxTimestamp: null, nonce: 61 } })
  }
  const bytes = await tx.build()
  chain.transactionData.V1 = bcs.TransactionData.parse(bytes).V1
  chain.rehashTransaction()
  buy.record.bytes = toBase64(bytes)
  buy.record.digest = chain.ledger.digest
  chain.eventsData.data = ActivityFixtureEventsBcs.parse(marketBuyEventEvidence(buy.record).bcs.value).data
  const e = chain.effectsData.V2, q = quoteAnimacraftV8SoulSale(BigInt(s.priceAtomic), s)
  function effect(id: string, before: ObjectRow | null, after: ObjectRow | null, owner: Owner) {
    if (!e) return
    const change = {
      inputState: before ? { Exist: [[String(before.version), before.digest], owner] } : { NotExist: true },
      outputState: after ? { ObjectWrite: [after.digest, owner] } : { NotExist: true },
      idOperation: before ? after ? { None: true } : { Deleted: true } : { Created: true },
    }
    e.changedObjects.push([id, change as typeof e.changedObjects[number][1]])
  }
  if (options.addressGas && e) {
    e.gasObjectIndex = null
    e.changedObjects.push(equipmentAddressGasEffect(s.buyer, -3n) as unknown as typeof e.changedObjects[number])
  } else {
    if (e) e.gasObjectIndex = 0
    effect(gasId, gasStart, coin(gasId, '1999997', s.buyer, 10, sui), buyer)
  }
  const config = move(s.release.marketConfigV2Id, `${native.typeOriginTable[0].package}::market::MarketConfigV2`, 2, shared,
    NativeMarketConfigBcs.serialize({ id: s.release.marketConfigV2Id, version: 2, legacy_config_id: zero,
      fee_recipient: s.protocolFeeRecipient, platform_fee_bps: 250, primary_enabled: false, secondary_enabled: true }).toBytes())
  e?.unchangedConsensusObjects.push([config.objectId, { $kind: 'ReadOnlyRoot', ReadOnlyRoot: ['2', config.digest] }])
  const listingType = `${s.release.soulidityOriginalPackageId}::market::SoulListing`
  const listing = { id: s.listingId, version: 8, soul_id: s.soulId, state_id: s.stateId, seller: s.seller, seller_kiosk_id: s.sellerKioskId,
    price: s.priceAtomic, creator: s.creator, creator_royalty_bps: s.soulCreatorRoyaltyBps, collection_id: null,
    purchase_cap: { id: bid(94), kiosk_id: s.sellerKioskId, item_id: s.soulId, min_price: 0 }, is_active: true }
  effect(s.listingId, move(s.listingId, listingType, 2, shared, NativeMarketListingBcs.serialize(listing).toBytes()),
    move(s.listingId, listingType, 10, shared, NativeMarketListingBcs.serialize({ ...listing, purchase_cap: null, is_active: false }).toBytes()), shared)
  const total = buy.record.paymentCoins.reduce((sum, c) => sum + BigInt(c.balanceAtomic), 0n)
  for (const [i, c] of buy.record.paymentCoins.entries()) {
    effect(c.objectId, objects.get(`${c.objectId}:2`)!, i === 0 ? coin(c.objectId, total - q.totalAtomic, s.buyer, 10) : null, buyer)
  }
  const payouts = [[s.seller, q.sellerPayoutAtomic], [s.creator, q.soulCreatorRoyaltyAtomic], [s.makerCreator, q.makerSourceRoyaltyAtomic],
    [s.protocolFeeRecipient, q.protocolFeeAtomic]] as const
  for (const [i, [owner, amount]] of payouts.entries()) {
    if (amount === 0n) continue
    const id = bid(210 + i)
    effect(id, null, coin(id, amount, owner, 10), { AddressOwner: owner })
  }
  if (options.newKiosk) {
    const id = bid(220), kiosk = bid(221)
    const cap = move(id, `${kioskFamily}::personal_kiosk::PersonalKioskCap`, 10, buyer,
      NativeCancelPersonalKioskCapBcs.serialize({ id, cap: { id: bid(222), for: kiosk } }).toBytes())
    effect(id, null, cap, buyer)
    const shared = { Shared: { initialSharedVersion: '10' } }
    effect(kiosk, null, move(kiosk, '0x2::kiosk::Kiosk', 10, shared, NativeCancelKioskBcs.serialize({
      id: kiosk, profits: 0, owner: s.buyer, item_count: 1, allow_extensions: false,
    }).toBytes()), shared)
  }
  if (handoff && e) {
    const buyerField = deriveKioskItemFieldId(handoff.kioskId, s.soulId)
    const sellerField = handoff.sellerFieldId!
    const bindingField = deriveDynamicFieldID(s.stateId, 'u8', new Uint8Array([9]))
    function copy(id: string, version: number, owner: Owner, source = handoff!.objects) {
      const row = source.get(id)
      return move(id, row.objectType, version, owner, row.contents.value)
    }
    const state = copy(s.stateId, 10, shared), before = NativeSoulStateBcs.parse(state.contents.value)
    Object.assign(before, { current_owner: s.seller, current_kiosk_id: s.sellerKioskId, ownership_epoch: s.ownershipEpoch, is_listed: true })
    effect(s.stateId, move(s.stateId, state.objectType, 2, shared, NativeSoulStateBcs.serialize(before).toBytes()), state, shared)
    const toBuyerKiosk = { ObjectOwner: handoff.kioskId }, toBuyerField = { ObjectOwner: buyerField }
    const soulBefore = copy(s.soulId, 2, { ObjectOwner: sellerField })
    const soul = copy(s.soulId, 10, toBuyerField), item = copy(buyerField, 10, toBuyerKiosk)
    effect(buyerField, null, item, toBuyerKiosk)
    e.changedObjects.push([s.soulId, {
      inputState: { Exist: [['2', soulBefore.digest], { ObjectOwner: sellerField }] },
      outputState: { ObjectWrite: [soul.digest, toBuyerField] }, idOperation: { None: true },
    } as typeof e.changedObjects[number][1]])
    const sellerKiosk = { ObjectOwner: s.sellerKioskId }
    effect(sellerField, copy(sellerField, 2, sellerKiosk, handoff.history), null, sellerKiosk)
    for (const row of [state, soul, item, copy(handoff.kioskId, 10, shared),
      copy(s.bindingId, 2, { Immutable: true }), copy(bindingField, 2, { ObjectOwner: s.stateId })]) latest.set(row.objectId, row)
  }
  chain.rehashEvents()
  const packages = new Map([[chain.pkg.objectId, chain.pkg], [kioskPkg.pkg.objectId, kioskPkg.pkg]])
  if (outputPkg) packages.set(outputPkg.pkg.objectId, outputPkg.pkg)
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://invalid.example' })
  function rpc(request: any, response: any) {
    return new UnaryCall({ name: 'Fixture' } as any, {}, request, Promise.resolve({}), Promise.resolve(response),
      Promise.resolve({ code: 'OK', detail: '' }), Promise.resolve({}))
  }
  vi.spyOn(client.ledgerService, 'getServiceInfo').mockImplementation(req => rpc(req, { chainId: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S' }))
  vi.spyOn(client.ledgerService, 'getTransaction').mockImplementation(req => rpc(req, { transaction: chain.ledger }))
  vi.spyOn(client.ledgerService, 'getCheckpoint').mockImplementation(req => rpc(req, { checkpoint: chain.checkpoint }))
  const getObject = vi.spyOn(client.ledgerService, 'getObject').mockImplementation(req => {
    if (req.version === undefined && missingLatest.has(req.objectId!)) throw Object.assign(new Error('Original Coin unavailable'), { code: 'NOT_FOUND' })
    const row = req.version === undefined ? packages.get(req.objectId) ?? latest.get(req.objectId!) : objects.get(`${req.objectId}:${req.version}`)
    return rpc(req, { object: row ? structuredClone({ ...row, ...(row.package ? { package: { ...row.package, modules: [], typeOrigins: [], linkage: [] } } : {}) }) : undefined })
  })
  vi.spyOn(client.movePackageService, 'getPackage').mockImplementation(req => rpc(req, { package: packages.get(req.packageId)?.package }))
  if (handoff) {
    client.core.getChainIdentifier = handoff.client.core.getChainIdentifier
    client.core.getDynamicField = handoff.client.core.getDynamicField
    vi.spyOn(client.ledgerService, 'batchGetObjects').mockImplementation(req => rpc(req, {
      objects: req.requests.map(({ objectId }) => latest.has(objectId!) ? { result: { oneofKind: 'object', object: structuredClone(latest.get(objectId!)) } }
        : { result: { oneofKind: 'error', error: { code: 5 } } }),
    }))
  }
  const run = () => queryMarketBuyPurchaseFunds(buy.record, client, new AbortController().signal)
  return { ...buy, s, chain, client, objects, latest, missingLatest, run, getObject, e, coin, effect, rpc, move, handoff }
}
