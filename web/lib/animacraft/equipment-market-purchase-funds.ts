import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase58, toHex } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { profileReadStep } from '@soulidity/sdk'
import { readActivityCheckpointEvidence } from '../soulidity/activity-transaction-evidence'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { readPinnedMovePackage } from '../sui/pinned-move-package'
import { readSuiGasSettlement } from '../sui/gas-settlement'
import { queryEquipmentMarketOperationEvidence } from './equipment-market-operation-evidence'
import { validateEquipmentMarketOperationRecord, type EquipmentMarketOperationRecord } from './equipment-market-operation'
import { marketListCanonical as canonical, marketListCheck as check } from './market-list-operation'
import { EquipmentMarketProtocolTreasuryBcs, EquipmentMarketTreasuryBcs } from './native-equipment-market-bcs'
import { decodeNativeBcs } from './native-receive'
import { readAuthenticatedEquipmentPurchaseCustody } from './browser-equipment-market-readback'

const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })

/** Read original component purchase funds using checkpoint-bound effects and exact historical objects. */
export async function queryEquipmentMarketPurchaseFunds(
  value: EquipmentMarketOperationRecord, source: SuiGrpcClient, parent: AbortSignal, options?: { proveCustody: true },
) {
  const record = validateEquipmentMarketOperationRecord(value)
  check(record.action === 'buy', 'Saved component purchase required')
  const signal = AbortSignal.any([parent, AbortSignal.timeout(60000)])
  const ledger = source.ledgerService
  const packages = source.movePackageService
  const client = { ledgerService: {
    getServiceInfo: ledger.getServiceInfo.bind(ledger), getTransaction: ledger.getTransaction.bind(ledger),
    getCheckpoint: ledger.getCheckpoint?.bind(ledger), getObject: ledger.getObject.bind(ledger),
  }, movePackageService: packages && { getPackage: packages.getPackage.bind(packages) } } as unknown as SuiGrpcClient
  const original = await profileReadStep(signal, () => queryEquipmentMarketOperationEvidence(record, client))
  const transactionDigest = record.digest
  signal.throwIfAborted()
  if (original.status !== 'SUCCEEDED') return { status: original.status, transactionDigest }
  const { checkpoint, effects, receipt } = original
  const e = effects.V2
  if (!e) return { status: 'LEGACY_EFFECTS' as const, transactionDigest, checkpoint }

  if (!original.addressGas) {
    const membership = await readActivityCheckpointEvidence({ client, chainIdentifier: '35834a8a', checkpoint, signal })
    const effectBytes = bcs.TransactionEffects.serialize(effects).toBytes()
    const hash = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('TransactionEffects::'), ...effectBytes]), { dkLen: 32 }))
    check(membership.epoch === e.executedEpoch && membership.transactions.some(row =>
      row.transactionDigest === transactionDigest && row.effectsDigest === hash), 'Component purchase effects missing from original checkpoint')
  }
  const gasAccumulatorIds = new Set(original.addressGas?.accumulatorIds ?? [])
  check(e.changedObjects.length <= 4096 && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length
    && e.changedObjects.every(([id, row]) => !row.outputState.AccumulatorWriteV1 || gasAccumulatorIds.has(id)), 'Unexpected component purchase money effects')

  const { snapshot: s, paymentCoins } = record
  const gross = BigInt(receipt.grossAtomic), fee = BigInt(receipt.protocolAtomic), seller = BigInt(receipt.sellerAtomic)
  const coinType = s.target.paymentCoinType, paymentType = `0x2::coin::Coin<${coinType}>`
  const read = (objectId: string, type: string, mode: 'input' | 'mutated' | 'created') =>
    readHistoricalMoveObject({ client, effects, transactionDigest, objectId, type, mode, signal })
  let balance = 0n
  for (const [index, ref] of paymentCoins.entries()) {
    const before = await read(ref.objectId, paymentType, 'input')
    const coin = decodeNativeBcs(Coin, before.bytes)
    check(before.reference.version === BigInt(ref.version) && before.reference.digest === ref.digest
      && before.object.owner.AddressOwner === s.actor && coin.id === ref.objectId && coin.balance === ref.balanceAtomic,
    'Original component payment coin mismatch')
    balance += BigInt(coin.balance)
    if (index > 0) {
      const consumed = e.changedObjects.find(([id]) => id === ref.objectId)![1]
      check(consumed.idOperation.$kind === 'Deleted' && consumed.outputState.$kind === 'NotExist', 'Merged component payment coin survived')
    }
  }
  const change = await read(paymentCoins[0].objectId, paymentType, 'mutated')
  const changeCoin = decodeNativeBcs(Coin, change.bytes)
  check(change.object.owner.AddressOwner === s.actor && changeCoin.id === paymentCoins[0].objectId
    && balance - BigInt(changeCoin.balance) === gross, 'Original component buyer debit mismatch')

  const payouts = e.changedObjects.filter(([, row]) => row.idOperation.$kind === 'Created' && row.outputState.ObjectWrite?.[1].AddressOwner)
  check(payouts.length === 1, 'Exactly one original component seller payout required')
  const payoutId = payouts[0][0], payout = await read(payoutId, paymentType, 'created')
  const payoutCoin = decodeNativeBcs(Coin, payout.bytes)
  check(payout.object.owner.AddressOwner === s.seller && payoutCoin.id === payoutId && BigInt(payoutCoin.balance) === seller
    && seller + fee === gross, 'Original component seller payout mismatch')

  const market = await readPinnedMovePackage(client, s.release.equipmentMarket!, signal)
  const coreId = s.release.coreOriginalPackageId, link = market.linkage.get(coreId)
  const marketOrigin = market.origins.get('market_v8::MarketTreasuryV8')
  check(link && marketOrigin, 'Original component treasury package linkage missing')
  const coreRaw = (await profileReadStep(signal, () => client.ledgerService.getObject({ objectId: link.upgradedId,
    readMask: { paths: ['object_id', 'digest'] } }, { abort: signal }))).response.object
  check(coreRaw?.objectId === link.upgradedId && coreRaw.digest, 'Original component Core pin unavailable')
  const core = await readPinnedMovePackage(client, { originalPackageId: coreId,
    callablePackageId: link.upgradedId, callableDigest: coreRaw.digest }, signal)
  const protocolOrigin = core.origins.get('protocol_config_v8::ProtocolTreasuryV8')
  check(String(core.version) === link.upgradedVersion && protocolOrigin, 'Original component protocol treasury type unavailable')

  const tx = Transaction.from(fromBase64(record.bytes)).getData()
  async function shared(id: string, type: string) {
    const input = tx.inputs.find(row => row.Object?.SharedObject?.objectId === id)?.Object?.SharedObject
    const before = await read(id, type, 'input'), after = await read(id, type, 'mutated')
    check(input?.mutable && before.object.owner.Shared?.initialSharedVersion === input.initialSharedVersion
      && after.object.owner.Shared?.initialSharedVersion === input.initialSharedVersion, 'Original component treasury shared birth mismatch')
    return [before.bytes, after.bytes] as const
  }
  const [marketBefore, marketAfter] = (await shared(s.target.treasuryId, `${marketOrigin}::market_v8::MarketTreasuryV8<${coinType}>`))
    .map(bytes => decodeNativeBcs(EquipmentMarketTreasuryBcs, bytes))
  check(marketBefore.id === s.target.treasuryId && marketBefore.version === '8'
    && marketBefore.catalog_id === s.target.catalogId && marketBefore.package_config_id === s.target.packageConfigId
    && marketBefore.root_id === s.target.rootId && marketBefore.maker_version === s.quoteContext.makerVersion
    && toHex(Uint8Array.from(marketBefore.root_content_commitment)) === s.quoteContext.rootContentCommitment
    && marketBefore.escrow.value === '0' && canonical(marketAfter) === canonical({ ...marketBefore,
      gross_escrowed_atomic: String(BigInt(marketBefore.gross_escrowed_atomic) + gross),
      gross_released_atomic: String(BigInt(marketBefore.gross_released_atomic) + gross) }), 'Original component escrow mismatch')
  const treasuryId = s.protocolTreasuryId!
  const [protocolBefore, protocolAfter] = (await shared(treasuryId, `${protocolOrigin}::protocol_config_v8::ProtocolTreasuryV8<${coinType}>`))
    .map(bytes => decodeNativeBcs(EquipmentMarketProtocolTreasuryBcs, bytes))
  check(protocolBefore.id === treasuryId && protocolBefore.version === '8' && protocolBefore.config_id === s.target.protocolConfigId
    && BigInt(protocolBefore.total_collected) - BigInt(protocolBefore.total_withdrawn) === BigInt(protocolBefore.revenue.value)
    && canonical(protocolAfter) === canonical({ ...protocolBefore, revenue: { value: String(BigInt(protocolBefore.revenue.value) + fee) },
      total_collected: String(BigInt(protocolBefore.total_collected) + fee) }), 'Original component platform credit mismatch')

  const gas = original.addressGas ?? await readSuiGasSettlement({ client, packet: record, effects, signal })
  const custody = options?.proveCustody ? await readAuthenticatedEquipmentPurchaseCustody(record, original, source, signal) : undefined
  signal.throwIfAborted()
  return { status: 'FUNDS_VERIFIED' as const, transactionDigest, checkpoint, coinType, receipt,
    sellerPayoutId: payoutId, protocolTreasuryId: treasuryId, buyerChangeAtomic: changeCoin.balance, gas, ...(custody ? { custody } : {}) }
}

export type EquipmentMarketPurchaseFunds = Awaited<ReturnType<typeof queryEquipmentMarketPurchaseFunds>>
