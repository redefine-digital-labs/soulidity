import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromHex, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { expect, it, vi } from 'vitest'
import { UnaryCall } from '@protobuf-ts/runtime-rpc'
import { createEquipmentListingOriginal } from '../../web/lib/animacraft/equipment-market-listing-original'
import { queryEquipmentSellerSettlement } from '../../web/lib/animacraft/equipment-market-seller-settlement'
import { EquipmentBaseItemBcs, EquipmentExternalItemBcs } from '../../web/lib/animacraft/native-equipment'
import { queryEquipmentMarketPurchaseFunds } from '../../web/lib/animacraft/equipment-market-purchase-funds'
import * as readback from '../../web/lib/animacraft/browser-equipment-market-readback'
import { createEquipmentPurchaseOriginal, queryEquipmentPurchaseOriginal } from '../../web/lib/animacraft/equipment-market-purchase-original'
import { buildEquipmentMarketOperationTransaction, equipmentMarketInputRoles, equipmentOperationQuote } from '../../web/lib/animacraft/equipment-market-operation'
import { EquipmentMarketListingBcs, EquipmentMarketProtocolTreasuryBcs, EquipmentMarketTreasuryBcs } from '../../web/lib/animacraft/native-equipment-market-bcs'
import { activityHash, adigest } from './fixtures/activity-transaction-evidence'
import { equipmentAddressGasEffect, equipmentAddressGasWindow, equipmentMarketEvidenceFixture, linkEquipmentOriginalCheckpoint } from './fixtures/equipment-market-evidence'
import { emid } from './fixtures/equipment-market-operation'

const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
type Owner = Parameters<typeof bcs.Owner.serialize>[0]
const shared = { Shared: { initialSharedVersion: '1' } }
const sender = (address: string) => ({ AddressOwner: address })

async function fixture(kind: 'base' | 'external' = 'base', variant = '', addressGas = false,
  opening?: 'list' | 'reprice', action: 'buy' | 'cancel' | 'recover' = 'buy') {
  const f = await equipmentMarketEvidenceFixture(action, kind)
  const r = f.record, s = r.snapshot
  const rows = new Map<string, any>(), changes: any[] = []
  const beforeVersion = opening ? 5 : 2, afterVersion = beforeVersion + 1
  const seller = opening ? await equipmentMarketEvidenceFixture(opening, kind) : null
  const protocolId = s.protocolTreasuryId!, payoutId = emid(951)
  const paymentType = `0x2::coin::Coin<${s.target.paymentCoinType}>`
  const gasType = '0x2::coin::Coin<0x2::sui::SUI>'
  function object(id: string, type: string, contents: Uint8Array, owner: Owner, version: number, previousTransaction = version === afterVersion ? r.digest : adigest(8)) {
    const tag = TypeTagSerializer.parseFromStr(type).struct!
    const raw = bcs.Object.serialize({ data: { Move: { type: { Other: tag }, hasPublicTransfer: true, version, contents } },
      owner, previousTransaction, storageRebate: 0 }).toBytes()
    const row = { objectId: id, objectType: normalizeStructTag(type), version: BigInt(version), digest: activityHash('Object', raw),
      bcs: { value: raw }, contents: { value: contents }, previousTransaction,
      owner: owner.Shared ? { kind: 3, version: BigInt(owner.Shared.initialSharedVersion) } : { kind: 1, address: owner.AddressOwner } }
    rows.set(`${id}:${version}`, row)
    return { row, owner }
  }
  function coin(id: string, type: string, balance: number, owner: string, version: number) {
    return object(id, type, Coin.serialize({ id, balance }).toBytes(), sender(owner), version)
  }
  function effect(id: string, before: ReturnType<typeof object> | null, after: ReturnType<typeof object> | null) {
    changes.push([id, { inputState: before ? { Exist: [[String(before.row.version), before.row.digest], before.owner] } : { NotExist: true },
      outputState: after ? { ObjectWrite: [after.row.digest, after.owner] } : { NotExist: true },
      idOperation: !before ? { Created: true } : !after ? { Deleted: true } : { None: true } }])
  }
  function pkg(id: string, originalId: string, module: string, names: string[], links = new Map()) {
    const typeOriginTable = names.map(datatypeName => ({ moduleName: module, datatypeName, package: originalId }))
    const bytes = bcs.Object.serialize({ data: { Package: { id, version: '2', moduleMap: new Map([[module, Uint8Array.of(1)]]),
      linkageTable: links, typeOriginTable } }, owner: { Immutable: true }, previousTransaction: adigest(8), storageRebate: 0 }).toBytes()
    return { objectId: id, digest: activityHash('Object', bytes), owner: { kind: 4 }, version: 2n, bcs: { value: bytes },
      package: { originalId, storageId: id, version: 2n, modules: [], linkage: [], typeOrigins: typeOriginTable.map(row => ({ ...row, packageId: row.package })) } }
  }
  const market = s.release.equipmentMarket!, coreId = s.release.coreOriginalPackageId
  const corePackage = pkg(emid(952), coreId, 'protocol_config_v8', ['ProtocolTreasuryV8'])
  const marketTypes = ['MarketTreasuryV8','MarketListingSettledV8']
  if (seller) marketTypes.push('MarketListingOpenedV8', 'MarketListingRepricedV8', 'MarketListingClosedV8', 'EquipmentListingV8')
  const marketPackage = pkg(market.callablePackageId, market.originalPackageId, 'market_v8', marketTypes,
    new Map([[coreId, { upgradedId: corePackage.objectId, upgradedVersion: variant === 'core version' ? '3' : '2' }]]))
  market.callableDigest = marketPackage.digest
  const runtimePin = s.release.runtime!
  const itemName = kind === 'base' ? 'OwnedBaseItemV8' : 'OwnedExternalItemV8'
  const runtimePackage = seller ? pkg(runtimePin.callablePackageId, runtimePin.originalPackageId, 'runtime_v8', ['EquipmentMarketCustodyTransitionV8', itemName]) : f.packages[1]
  const listingId = s.listing!.id, itemType = `${runtimePin.originalPackageId}::runtime_v8::${itemName}`
  const bornVersion = opening === 'list' ? '3' : '1'
  if (opening === 'reprice') {
    r.priceAtomic = seller!.record.priceAtomic
    const quote = equipmentOperationQuote(s, r.priceAtomic)
    s.listing = { ...s.listing!, revision: '8', priceAtomic: r.priceAtomic, quoteCommitment: quote.commitment }
    f.changeMarket(event => Object.assign(event, {
      gross_atomic: quote.grossAtomic, protocol_atomic: quote.protocolAtomic, seller_atomic: quote.sellerAtomic,
    }))
  }
  const rawItem = f.objects.get(s.asset.itemId)!
  const originalItem = seller ? object(s.asset.itemId, itemType, rawItem.contents.value, sender(listingId), beforeVersion) : null
  if (originalItem && seller) {
    runtimePin.callableDigest = runtimePackage.digest
    s.reference = { objectId: s.asset.itemId, version: String(beforeVersion), digest: originalItem.row.digest }
    seller.record.snapshot.release.equipmentMarket!.callableDigest = marketPackage.digest
    seller.record.snapshot.release.runtime!.callableDigest = runtimePackage.digest
    seller.changeMarket(event => { event.listing_id = listingId })
    if (opening === 'list') seller.changeCustody(event => { event.listing_id = listingId })
  }
  const [primaryId, mergeId, gasId] = [emid(901), emid(903), emid(902)]
  const primary = coin(primaryId, paymentType, 10000, s.actor, beforeVersion)
  const mergeBalance = opening === 'reprice' ? 20000 : 10000
  const merge = coin(mergeId, paymentType, mergeBalance, s.actor, beforeVersion)
  const gas = coin(gasId, gasType, 200000, s.actor, beforeVersion)
  if (action === 'buy') r.paymentCoins = [primary, merge].map(({ row }, i) => ({
    objectId: row.objectId, version: String(beforeVersion), digest: row.digest, balanceAtomic: String(i === 0 ? 10000 : mergeBalance),
  }))
  const roles = equipmentMarketInputRoles(r)
  const draft = buildEquipmentMarketOperationTransaction(r).getData()
  draft.inputs = draft.inputs.map(input => {
    const id = input.UnresolvedObject?.objectId
    if (!id) return input
    const ref = r.paymentCoins.find(coin => coin.objectId === id)
      ?? f.tx.getData().inputs.find(row => row.Object?.ImmOrOwnedObject?.objectId === id)?.Object?.ImmOrOwnedObject
    return roles.owned.has(id) ? Inputs.ObjectRef(ref!)
      : Inputs.SharedObjectRef({ objectId: id, initialSharedVersion: id === listingId ? bornVersion : '1', mutable: roles.mutable.has(id) })
  })
  const tx = Transaction.from(JSON.stringify(draft))
  tx.setSender(s.actor); tx.setGasOwner(s.actor); tx.setGasBudget(100000); tx.setGasPrice(1)
  tx.setGasPayment(addressGas ? [] : [{ objectId: gasId, version: String(beforeVersion), digest: gas.row.digest }])
  tx.setExpiration(addressGas ? { ValidDuring: equipmentAddressGasWindow } : { Epoch: 9 })
  const bytes = await tx.build()
  r.bytes = toBase64(bytes); r.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  Object.assign(f.ledger, { digest: r.digest, transaction: { digest: r.digest, bcs: { value: bytes } } })
  f.ledger.effects.transactionDigest = r.digest

  const quote = equipmentOperationQuote(s, r.priceAtomic)
  if (action === 'buy') {
    effect(primaryId, primary, coin(primaryId, paymentType, variant === 'buyer debit' ? 10000 : 9999, s.actor, afterVersion))
    effect(mergeId, merge, variant === 'surviving merge' ? coin(mergeId, paymentType, 0, s.actor, afterVersion) : null)
  }
  if (addressGas) {
    const delta = variant === 'address gas rebate' ? 2n : variant === 'address gas amount' ? -2n : -1n
    changes.push(equipmentAddressGasEffect(variant === 'address gas owner' ? s.seller : s.actor, delta))
    if (variant === 'address gas rebate') f.effects.V2.gasUsed.storageRebate = '3'
    if (variant === 'address gas extra') changes.push(equipmentAddressGasEffect(s.seller, 1n))
  } else effect(gasId, gas, coin(gasId, gasType, variant === 'gas' ? 200000 : 199999, s.actor, afterVersion))
  if (action === 'buy') {
    effect(payoutId, null, coin(payoutId, paymentType, Number(quote.sellerAtomic) - (variant === 'seller amount' ? 1 : 0),
      variant === 'seller owner' ? s.actor : s.seller, afterVersion))
    const marketType = `${market.originalPackageId}::market_v8::MarketTreasuryV8<${s.target.paymentCoinType}>`
    const escrow = { id: s.target.treasuryId, version: '8', catalog_id: s.target.catalogId, package_config_id: s.target.packageConfigId,
      root_id: s.target.rootId, maker_version: s.quoteContext.makerVersion,
      root_content_commitment: fromHex(s.quoteContext.rootContentCommitment), escrow: { value: '0' },
      gross_escrowed_atomic: '30', gross_released_atomic: '30' }
    effect(escrow.id, object(escrow.id, marketType, EquipmentMarketTreasuryBcs.serialize(escrow).toBytes(), shared, beforeVersion),
      object(escrow.id, marketType, EquipmentMarketTreasuryBcs.serialize({ ...escrow, gross_escrowed_atomic: String(30n + BigInt(quote.grossAtomic)),
        gross_released_atomic: String((variant === 'escrow' ? 29n : 30n) + BigInt(quote.grossAtomic)) }).toBytes(), shared, afterVersion))
    const protocolType = `${coreId}::protocol_config_v8::ProtocolTreasuryV8<${s.target.paymentCoinType}>`
    const protocol = { id: protocolId, version: '8', config_id: s.target.protocolConfigId,
      revenue: { value: '100' }, total_collected: '110', total_withdrawn: '10' }
    effect(protocolId, object(protocolId, protocolType, EquipmentMarketProtocolTreasuryBcs.serialize(protocol).toBytes(), shared, beforeVersion),
      object(protocolId, protocolType, EquipmentMarketProtocolTreasuryBcs.serialize({ ...protocol, revenue: { value: String(100n + BigInt(quote.protocolAtomic)) },
        total_collected: String((variant === 'platform credit' ? 111n : 110n) + BigInt(quote.protocolAtomic)) }).toBytes(), shared, afterVersion))
  }
  let closingListing: ReturnType<typeof object> | null = null
  let openingCheckpoint: Awaited<ReturnType<typeof linkEquipmentOriginalCheckpoint>> | null = null
  if (seller && originalItem) {
    const listingType = `${market.originalPackageId}::market_v8::EquipmentListingV8<${s.target.paymentCoinType}>`
    const rawListing = f.objects.get(listingId)!
    const previousListing = EquipmentMarketListingBcs.parse(rawListing.contents.value)
    const listing = { ...previousListing, revision: s.listing!.revision, gross_atomic: quote.grossAtomic,
      protocol_atomic: quote.protocolAtomic, seller_atomic: quote.sellerAtomic, quote_commitment: fromHex(quote.commitment) }
    const born = { Shared: { initialSharedVersion: bornVersion } }
    const initial = object(listingId, listingType, EquipmentMarketListingBcs.serialize({
      ...listing, revision: opening === 'list' ? '0' : listing.revision,
    }).toBytes(), born, 3, seller.record.digest)
    const input = object(listingId, listingType, EquipmentMarketListingBcs.serialize(listing).toBytes(), born, beforeVersion)
    const recipient = action === 'buy' ? s.actor : s.seller
    const status = { buy: 1, cancel: 2, recover: 3 }[action]
    closingListing = object(listingId, listingType, EquipmentMarketListingBcs.serialize({
      ...listing, status, revision: String(BigInt(listing.revision) + 1n), terminal_recipient: recipient,
    }).toBytes(), born, afterVersion)
    const itemCodec = (kind === 'base' ? EquipmentBaseItemBcs : EquipmentExternalItemBcs) as typeof EquipmentBaseItemBcs
    const item = itemCodec.parse(rawItem.contents.value)
    const delivered = object(s.asset.itemId, itemType, itemCodec.serialize({ ...item, holder: recipient, ownership_epoch: action === 'buy' ? '1' : '0' }).toBytes(),
      sender(recipient), afterVersion)
    effect(listingId, input, closingListing)
    effect(s.asset.itemId, originalItem, delivered)
    seller.ledger.checkpoint = 19n
    const predecessor = opening === 'reprice' ? object(listingId, listingType, rawListing.contents.value, born, 2) : null
    seller.effects.V2.changedObjects = [[listingId, {
      inputState: predecessor ? { Exist: [['2', predecessor.row.digest], born] } : { NotExist: true },
      idOperation: predecessor ? { None: true } : { Created: true },
      outputState: { ObjectWrite: [initial.row.digest, born] },
    }]]
    seller.refresh()
    openingCheckpoint = await linkEquipmentOriginalCheckpoint(seller)
  }
  Object.assign(f.effects.V2, { transactionDigest: r.digest, lamportVersion: String(afterVersion), changedObjects: changes, gasObjectIndex: addressGas ? null : action === 'buy' ? 2 : 0 })
  f.refresh()
  const checkoutCheckpoint = await linkEquipmentOriginalCheckpoint(f, variant === 'checkpoint')
  if (variant === 'direct package wire') {
    const identity = { storageId: marketPackage.objectId, originalId: market.originalPackageId, version: marketPackage.version }
    Object.assign(marketPackage.package, { storageId: undefined, originalId: undefined, version: undefined })
    f.client.movePackageService = { getPackage: vi.fn(async () => ({ response: { package: identity } })) }
  }
  const packages = new Map([marketPackage, corePackage, runtimePackage].map(row => [row.objectId, row]))
  const getObject = ({ objectId, version }: { objectId: string; version?: bigint }) => ({
    object: version === undefined
      ? objectId === listingId && closingListing ? closingListing.row : packages.get(objectId) : rows.get(`${objectId}:${version}`),
  })
  f.client.ledgerService.getObject = vi.fn(async request => ({ response: getObject(request) }))
  if (seller && openingCheckpoint) {
    f.client.ledgerService.getObject = vi.fn(request => new UnaryCall({ name: 'Fixture' } as never, {}, request,
      Promise.resolve({}), Promise.resolve(getObject(request)), Promise.resolve({ code: 'OK', detail: '' }), Promise.resolve({})))
    f.client.movePackageService = { getPackage: vi.fn(async ({ packageId }) => ({ response: {
      package: packages.get(packageId)?.package,
    } })) }
    const result = f.ledger
    result.timestamp = checkoutCheckpoint.summary.timestamp
    result.transaction.sender = s.actor
    Object.assign(result.effects, { version: 2, epoch: 9n, digest: activityHash('TransactionEffects', result.effects.bcs.value),
      eventsDigest: result.events.digest })
    f.client.core = f.rawClient.core
    f.client.ledgerService.getCheckpoint = vi.fn(async ({ checkpointId }) => ({ response: {
      checkpoint: checkpointId.sequenceNumber === 19n ? openingCheckpoint : checkoutCheckpoint,
    } }))
    f.client.ledgerService.getTransaction = vi.fn(async ({ digest }) => ({ response: {
      transaction: digest === seller.record.digest ? seller.ledger : digest === r.digest ? result : undefined,
    } }))
  }
  return { ...f, rows, payoutId, seller, confirm: () => queryEquipmentMarketPurchaseFunds(r, f.client, new AbortController().signal) }
}

it.each(['base', 'external'] as const)('verifies original %s purchase debit, seller Coin, platform credit and independent gas', async kind => {
  const f = await fixture(kind)
  expect(await f.confirm()).toMatchObject({ status: 'FUNDS_VERIFIED', checkpoint: '20', transactionDigest: f.record.digest,
    receipt: { assetKind: kind, assetId: f.record.snapshot.asset.itemId, grossAtomic: '10001', protocolAtomic: '250', sellerAtomic: '9751' },
    buyerChangeAtomic: '9999', sellerPayoutId: f.payoutId, gas: { netGasCharge: '1' } })
})
it.each(['base', 'external'] as const)('reconciles %s USDC settlement independently of address gas', async kind => {
  const f = await fixture(kind, '', true)
  expect(await f.confirm()).toMatchObject({ status: 'FUNDS_VERIFIED', buyerChangeAtomic: '9999', sellerPayoutId: f.payoutId,
    receipt: { protocolAtomic: '250', sellerAtomic: '9751' },
    gas: { owner: f.record.snapshot.actor, netGasCharge: '1', proof: 'original-address-balance-effects-only' } })
  expect(f.client.ledgerService.getCheckpoint).toHaveBeenCalledTimes(1)
  expect(f.client.ledgerService.getObject.mock.calls.some(([request]) => request.objectId === emid(902))).toBe(false)
})
it('keeps an original address gas storage rebate separate from USDC settlement', async () => {
  const f = await fixture('external', 'address gas rebate', true)
  expect(await f.confirm()).toMatchObject({ status: 'FUNDS_VERIFIED', buyerChangeAtomic: '9999', gas: { netGasCharge: '-2' } })
})
it.each([
  ['address gas owner', 'WRITE_MISMATCH'], ['address gas amount', 'WRITE_MISMATCH'],
  ['address gas extra', 'EXTRA_ACCUMULATOR'], ['checkpoint', 'missing from original checkpoint'],
  ['seller amount', 'seller payout mismatch'], ['platform credit', 'platform credit mismatch'],
])('rejects contradictory %s in an address-funded original', async (variant, reason) => {
  const f = await fixture('external', variant, true)
  await expect(f.confirm()).rejects.toThrow(reason)
})
it('proves original seller and treasury funds when direct gRPC omits upgraded Market package identity', async () => {
  const f = await fixture('base', 'direct package wire')
  expect(await f.confirm()).toMatchObject({ status: 'FUNDS_VERIFIED', sellerPayoutId: f.payoutId, gas: { netGasCharge: '1' } })
  expect(f.client.movePackageService.getPackage).toHaveBeenCalledWith(
    { packageId: f.record.snapshot.release.equipmentMarket!.callablePackageId }, expect.anything())
})
it.each([
  ['checkpoint', 'missing from original checkpoint'], ['buyer debit', 'buyer debit mismatch'],
  ['surviving merge', 'payment coin survived'], ['seller amount', 'seller payout mismatch'],
  ['seller owner', 'seller payout mismatch'], ['escrow', 'escrow mismatch'],
  ['platform credit', 'platform credit mismatch'], ['core version', 'protocol treasury type unavailable'],
  ['gas', 'SUI_GAS_SETTLEMENT_BALANCE'],
])('rejects %s despite otherwise matching events and packet', async (variant, reason) => {
  const f = await fixture('external', variant)
  await expect(f.confirm()).rejects.toThrow(reason)
})
it('keeps unknown original payment query-only without reading new funds', async () => {
  const f = await fixture()
  f.client.ledgerService.getTransaction.mockRejectedValue({ code: 'NOT_FOUND' })
  await expect(f.confirm()).resolves.toEqual({ status: 'MISSING', transactionDigest: f.record.digest })
  expect(f.client.ledgerService.getObject).not.toHaveBeenCalled()
})
it('keeps older successful Effects V1 queryable without claiming a funds proof', async () => {
  const f = await fixture()
  const { gasUsed, eventsDigest, executedEpoch } = f.effects.V2
  f.ledger.effects.bcs.value = bcs.TransactionEffects.serialize({ V1: {
    status: { Success: true }, executedEpoch, gasUsed, transactionDigest: f.record.digest, modifiedAtVersions: [],
    sharedObjects: [], created: [], mutated: [], unwrapped: [], deleted: [], unwrappedThenDeleted: [], wrapped: [],
    gasObject: [{ objectId: emid(902), version: '3', digest: adigest(9) }, sender(f.record.snapshot.actor)], eventsDigest, dependencies: [],
  } }).toBytes()
  await expect(f.confirm()).resolves.toEqual({ status: 'LEGACY_EFFECTS', transactionDigest: f.record.digest, checkpoint: '20' })
  expect(f.client.ledgerService.getCheckpoint).not.toHaveBeenCalled()
})

it.each(['COMPLETE', 'CURRENT_UNAVAILABLE'] as const)('feeds custody the same checkpoint-bound original effects used for money after a cold import (%s)', async status => {
  const f = await fixture('external', '', true), s = f.record.snapshot
  const delivered = { itemType: 'OwnedExternalItemV8', sourceId: s.asset.kind === 'external' ? s.asset.productId : '',
    originalHolder: s.actor, originalOwnershipEpoch: '2' }
  const custody = status === 'CURRENT_UNAVAILABLE' ? { ...delivered, status }
    : { ...delivered, status, currentHolder: s.actor, currentAddressOwner: s.actor,
      currentOwnershipEpoch: '2', currentListingId: null }
  const read = vi.spyOn(readback, 'readAuthenticatedEquipmentPurchaseCustody').mockResolvedValue(custody)
  try {
    const original = JSON.parse(JSON.stringify(createEquipmentPurchaseOriginal(f.record)))
    const result = await queryEquipmentPurchaseOriginal(original, s.asset.itemId, f.client, new AbortController().signal)
    expect(result).toMatchObject({ status: 'FUNDS_VERIFIED', checkpoint: '20', custody, transactionDigest: f.record.digest })
    expect(read).toHaveBeenCalledOnce()
    const [record, proof] = read.mock.calls[0]
    expect(record).toMatchObject({ digest: f.record.digest, phase: 'PREPARED', signature: null })
    expect(bcs.TransactionEffects.serialize(proof.effects).toBytes()).toEqual(f.ledger.effects.bcs.value)
    expect(f.client.ledgerService.getCheckpoint).toHaveBeenCalledTimes(1)
  } finally { read.mockRestore() }
})


it.each(['base','external'] as const)('reconstructs a %s purchase from the seller listing and verifies actual settlement and delivery', async kind => {
  const f = await fixture(kind, '', kind === 'external', 'list')
  const opening = createEquipmentListingOriginal(f.seller!.record)
  const result = await queryEquipmentSellerSettlement(opening, f.client, new AbortController().signal)
  const snapshot = f.record.snapshot
  expect(result).toMatchObject({ status: 'SOLD', transactionDigest: f.seller!.record.digest, listingId: f.listingId,
    openingCheckpoint: '19', sale: { status: 'FUNDS_VERIFIED', transactionDigest: f.record.digest, checkpoint: '20',
      sellerPayoutId: f.payoutId, protocolTreasuryId: snapshot.protocolTreasuryId,
      receipt: { assetId: snapshot.asset.itemId, grossAtomic: '10001', sellerAtomic: '9751', protocolAtomic: '250', recipient: snapshot.actor },
      custody: { status: 'CURRENT_UNAVAILABLE', itemType: expect.stringContaining(kind === 'base' ? 'OwnedBaseItemV8' : 'OwnedExternalItemV8'),
        originalHolder: snapshot.actor, originalOwnershipEpoch: '1',
        sourceId: snapshot.asset.kind === 'base' ? snapshot.asset.baseRegistryId : snapshot.asset.productId } } })
})

it('rejects the wrong seller payout even from a valid opening listing and committed close', async () => {
  const f = await fixture('external', 'seller owner', false, 'list')
  await expect(queryEquipmentSellerSettlement(createEquipmentListingOriginal(f.seller!.record), f.client, new AbortController().signal))
    .rejects.toThrow('seller payout mismatch')
})

it('reads settlement at the committed new price after a seller reprices', async () => {
  const f = await fixture('external', '', true, 'reprice')
  const result = await queryEquipmentSellerSettlement(createEquipmentListingOriginal(f.seller!.record), f.client, new AbortController().signal)
  expect(result).toMatchObject({ status: 'SOLD', transactionDigest: f.seller!.record.digest,
    sale: { transactionDigest: f.record.digest, buyerChangeAtomic: '9999',
      receipt: { grossAtomic: '20001', protocolAtomic: '500', sellerAtomic: '19501' } } })
})

it.each([
  ['base', 'cancel', 'CANCELLED'],
  ['external', 'recover', 'RECOVERED'],
] as const)('proves %s original custody return after %s', async (kind, action, status) => {
  const f = await fixture(kind, '', false, 'list', action)
  const result = await queryEquipmentSellerSettlement(createEquipmentListingOriginal(f.seller!.record), f.client, new AbortController().signal)
  expect(result).toEqual({ status, transactionDigest: f.seller!.record.digest, listingId: f.listingId,
    openingCheckpoint: '19', closingDigest: f.record.digest, closingCheckpoint: '20', holder: f.record.snapshot.seller })
})
