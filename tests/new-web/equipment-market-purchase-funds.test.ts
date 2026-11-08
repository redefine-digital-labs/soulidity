import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromHex, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { expect, it, vi } from 'vitest'
import { queryEquipmentMarketPurchaseFunds } from '../../web/lib/animacraft/equipment-market-purchase-funds'
import * as readback from '../../web/lib/animacraft/browser-equipment-market-readback'
import { createEquipmentPurchaseOriginal, queryEquipmentPurchaseOriginal } from '../../web/lib/animacraft/equipment-market-purchase-original'
import { buildEquipmentMarketOperationTransaction, equipmentMarketInputRoles, equipmentOperationQuote } from '../../web/lib/animacraft/equipment-market-operation'
import { EquipmentMarketProtocolTreasuryBcs, EquipmentMarketTreasuryBcs } from '../../web/lib/animacraft/native-equipment-market-bcs'
import { activityHash, adigest } from './fixtures/activity-transaction-evidence'
import { equipmentAddressGasEffect, equipmentAddressGasWindow, equipmentMarketEvidenceFixture, linkEquipmentOriginalCheckpoint } from './fixtures/equipment-market-evidence'
import { emid } from './fixtures/equipment-market-operation'

const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
type Owner = Parameters<typeof bcs.Owner.serialize>[0]
const shared = { Shared: { initialSharedVersion: '1' } }
const sender = (address: string) => ({ AddressOwner: address })

async function fixture(kind: 'base' | 'external' = 'base', variant = '', addressGas = false) {
  const f = await equipmentMarketEvidenceFixture('buy', kind)
  const r = f.record, s = r.snapshot
  const rows = new Map<string, any>(), changes: any[] = []
  const protocolId = s.protocolTreasuryId!, payoutId = emid(951)
  const paymentType = `0x2::coin::Coin<${s.target.paymentCoinType}>`
  const gasType = '0x2::coin::Coin<0x2::sui::SUI>'
  function object(id: string, type: string, contents: Uint8Array, owner: Owner, version: number) {
    const previousTransaction = version === 3 ? r.digest : adigest(8)
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
      package: { originalId, storageId: id, version: 2n, typeOrigins: typeOriginTable.map(row => ({ ...row, packageId: row.package })) } }
  }
  const market = s.release.equipmentMarket!, coreId = s.release.coreOriginalPackageId
  const corePackage = pkg(emid(952), coreId, 'protocol_config_v8', ['ProtocolTreasuryV8'])
  const marketPackage = pkg(market.callablePackageId, market.originalPackageId, 'market_v8', ['MarketTreasuryV8','MarketListingSettledV8'],
    new Map([[coreId, { upgradedId: corePackage.objectId, upgradedVersion: variant === 'core version' ? '3' : '2' }]]))
  market.callableDigest = marketPackage.digest
  const [primaryId, mergeId, gasId] = [emid(901), emid(903), emid(902)]
  const primary = coin(primaryId, paymentType, 10000, s.actor, 2)
  const merge = coin(mergeId, paymentType, 10000, s.actor, 2)
  const gas = coin(gasId, gasType, 200000, s.actor, 2)
  r.paymentCoins = [primary, merge].map(({ row }) => ({ objectId: row.objectId, version: '2', digest: row.digest, balanceAtomic: '10000' }))
  const roles = equipmentMarketInputRoles(r)
  const draft = buildEquipmentMarketOperationTransaction(r).getData()
  draft.inputs = draft.inputs.map(input => {
    const id = input.UnresolvedObject?.objectId
    if (!id) return input
    const ref = r.paymentCoins.find(coin => coin.objectId === id)
      ?? f.tx.getData().inputs.find(row => row.Object?.ImmOrOwnedObject?.objectId === id)?.Object?.ImmOrOwnedObject
    return roles.owned.has(id) ? Inputs.ObjectRef(ref!)
      : Inputs.SharedObjectRef({ objectId: id, initialSharedVersion: '1', mutable: roles.mutable.has(id) })
  })
  const tx = Transaction.from(JSON.stringify(draft))
  tx.setSender(s.actor); tx.setGasOwner(s.actor); tx.setGasBudget(100000); tx.setGasPrice(1)
  tx.setGasPayment(addressGas ? [] : [{ objectId: gasId, version: '2', digest: gas.row.digest }])
  tx.setExpiration(addressGas ? { ValidDuring: equipmentAddressGasWindow } : { Epoch: 9 })
  const bytes = await tx.build()
  r.bytes = toBase64(bytes); r.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  Object.assign(f.ledger, { digest: r.digest, transaction: { digest: r.digest, bcs: { value: bytes } } })
  f.ledger.effects.transactionDigest = r.digest

  const quote = equipmentOperationQuote(s, r.priceAtomic)
  effect(primaryId, primary, coin(primaryId, paymentType, variant === 'buyer debit' ? 10000 : 9999, s.actor, 3))
  effect(mergeId, merge, variant === 'surviving merge' ? coin(mergeId, paymentType, 0, s.actor, 3) : null)
  if (addressGas) {
    const delta = variant === 'address gas rebate' ? 2n : variant === 'address gas amount' ? -2n : -1n
    changes.push(equipmentAddressGasEffect(variant === 'address gas owner' ? s.seller : s.actor, delta))
    if (variant === 'address gas rebate') f.effects.V2.gasUsed.storageRebate = '3'
    if (variant === 'address gas extra') changes.push(equipmentAddressGasEffect(s.seller, 1n))
  } else effect(gasId, gas, coin(gasId, gasType, variant === 'gas' ? 200000 : 199999, s.actor, 3))
  effect(payoutId, null, coin(payoutId, paymentType, Number(quote.sellerAtomic) - (variant === 'seller amount' ? 1 : 0),
    variant === 'seller owner' ? s.actor : s.seller, 3))
  const marketType = `${market.originalPackageId}::market_v8::MarketTreasuryV8<${s.target.paymentCoinType}>`
  const escrow = { id: s.target.treasuryId, version: '8', catalog_id: s.target.catalogId, package_config_id: s.target.packageConfigId,
    root_id: s.target.rootId, maker_version: s.quoteContext.makerVersion,
    root_content_commitment: fromHex(s.quoteContext.rootContentCommitment), escrow: { value: '0' },
    gross_escrowed_atomic: '30', gross_released_atomic: '30' }
  effect(escrow.id, object(escrow.id, marketType, EquipmentMarketTreasuryBcs.serialize(escrow).toBytes(), shared, 2),
    object(escrow.id, marketType, EquipmentMarketTreasuryBcs.serialize({ ...escrow, gross_escrowed_atomic: '10031',
      gross_released_atomic: variant === 'escrow' ? '10030' : '10031' }).toBytes(), shared, 3))
  const protocolType = `${coreId}::protocol_config_v8::ProtocolTreasuryV8<${s.target.paymentCoinType}>`
  const protocol = { id: protocolId, version: '8', config_id: s.target.protocolConfigId,
    revenue: { value: '100' }, total_collected: '110', total_withdrawn: '10' }
  effect(protocolId, object(protocolId, protocolType, EquipmentMarketProtocolTreasuryBcs.serialize(protocol).toBytes(), shared, 2),
    object(protocolId, protocolType, EquipmentMarketProtocolTreasuryBcs.serialize({ ...protocol, revenue: { value: '350' },
      total_collected: variant === 'platform credit' ? '361' : '360' }).toBytes(), shared, 3))
  Object.assign(f.effects.V2, { transactionDigest: r.digest, changedObjects: changes, gasObjectIndex: addressGas ? null : 2 })
  f.refresh()
  await linkEquipmentOriginalCheckpoint(f, variant === 'checkpoint')
  if (variant === 'direct package wire') {
    const identity = { storageId: marketPackage.objectId, originalId: market.originalPackageId, version: marketPackage.version }
    Object.assign(marketPackage.package, { storageId: undefined, originalId: undefined, version: undefined })
    f.client.movePackageService = { getPackage: vi.fn(async () => ({ response: { package: identity } })) }
  }
  const packages = new Map([marketPackage, corePackage, f.packages[1]].map(row => [row.objectId, row]))
  f.client.ledgerService.getObject = vi.fn(async ({ objectId, version }) => ({
    response: { object: version === undefined ? packages.get(objectId) : rows.get(`${objectId}:${version}`) },
  }))
  return { ...f, rows, payoutId, confirm: () => queryEquipmentMarketPurchaseFunds(r, f.client, new AbortController().signal) }
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

it('feeds custody the same checkpoint-bound original effects used for money after a cold import', async () => {
  const f = await fixture('external', '', true), s = f.record.snapshot
  const custody = { status: 'COMPLETE', itemType: 'OwnedExternalItemV8', sourceId: s.asset.kind === 'external' ? s.asset.productId : '',
    originalHolder: s.actor, originalOwnershipEpoch: '2', currentHolder: s.actor, currentAddressOwner: s.actor,
    currentOwnershipEpoch: '2', currentListingId: null } as const
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
