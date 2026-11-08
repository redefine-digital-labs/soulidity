import { bcs } from '@mysten/sui/bcs'
import { normalizeStructTag } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { readSuiGasSettlement } from '../../sui/gas-settlement'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { EconomicsConfigBcs } from './economics-bcs'
import { incomeLedgerWitness } from './income-ledger-witness'
import { commerceCheck, decodeCommerce } from './economics-read'
import { proveNativePublicReadPaidReceiptV2 } from './native-public-read-paid-receipt-v2'

const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })

/** Exact original Coin debit, beneficiary payout, platform income and gas.
 * Parent owes original finality/events, Host Link/Auth/Offer/custody/source authority, complete effects
 * and current usable delivery. A payment event alone never invokes this proof.
 */
export async function proveNativePublicReadPaidMoneyV2(input: Parameters<typeof proveNativePublicReadPaidReceiptV2>[0]) {
  const saved = structuredClone({ intent: input.intent, packet: input.packet, gas: input.gas, effects: input.effects, offer: input.offer,
    soulId: input.soulId, ledgerId: input.ledgerId, native: input.native, content: input.content, foundation: input.foundation })
  const { signal } = input, p = saved.intent, e = saved.effects.V2
  const ledgerSource = input.client.ledgerService
  const client = { ledgerService: { getObject: ledgerSource.getObject.bind(ledgerSource) } } as unknown as typeof input.client
  commerceCheck(e && e.changedObjects.length <= 4096 && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length
    && e.changedObjects.every(([, row]) => !row.outputState.AccumulatorWriteV1), 'PUBLIC_PAID_V2_MONEY_EFFECTS')
  const receipt = await proveNativePublicReadPaidReceiptV2({ ...saved, client, signal })
  const foundation = await readPinnedMovePackage(client, saved.foundation, signal), origin = foundation.origins.get('economics::Config')
  commerceCheck(origin, 'PUBLIC_PAID_V2_MONEY_CONFIG_ORIGIN')
  const read = (id: string, type: string, mode: 'input' | 'mutated' | 'created') => readHistoricalMoveObject({ client, effects: saved.effects,
    transactionDigest: saved.packet.digest, objectId: id, type, mode, signal })
  const configType = `${origin}::economics::Config<${normalizeStructTag(p.coinType)}>`
  const beforeObject = await read(p.config.objectId, configType, 'input'), afterObject = await read(p.config.objectId, configType, 'mutated')
  const before = decodeCommerce(EconomicsConfigBcs, beforeObject.bytes), after = decodeCommerce(EconomicsConfigBcs, afterObject.bytes)
  const fee = BigInt(receipt.receipt.platform_fee)
  commerceCheck(beforeObject.object.owner.Shared?.initialSharedVersion === p.config.initialSharedVersion
    && afterObject.object.owner.Shared?.initialSharedVersion === p.config.initialSharedVersion
    && BigInt(before.income.collected) - BigInt(before.income.withdrawn) === BigInt(before.income.funds)
    && publicMutationCanonical(after) === publicMutationCanonical({ ...before, income: { ...before.income,
      funds: String(BigInt(before.income.funds) + fee), collected: String(BigInt(before.income.collected) + fee),
      revision: String(BigInt(before.income.revision) + (fee > 0n ? 1n : 0n)) } }), 'PUBLIC_PAID_V2_MONEY_PLATFORM_INCOME')
  const coinType = `0x2::coin::Coin<${normalizeStructTag(p.coinType)}>`, ref = p.paymentCoin
  const source = await read(ref.objectId, coinType, 'input'), change = await read(ref.objectId, coinType, 'mutated')
  const sourceCoin = decodeCommerce(Coin, source.bytes), changeCoin = decodeCommerce(Coin, change.bytes)
  commerceCheck(source.reference.version === BigInt(ref.version) && source.reference.digest === ref.digest
    && source.object.owner.AddressOwner === p.buyer && change.object.owner.AddressOwner === p.buyer
    && sourceCoin.id === ref.objectId && changeCoin.id === ref.objectId && sourceCoin.balance === ref.balance
    && BigInt(sourceCoin.balance) - BigInt(changeCoin.balance) === BigInt(receipt.receipt.total), 'PUBLIC_PAID_V2_MONEY_BUYER_DEBIT')
  const created = e.changedObjects.filter(([, row]) => row.idOperation.$kind === 'Created' && row.outputState.ObjectWrite?.[1].AddressOwner)
  commerceCheck(created.length === 1, 'PUBLIC_PAID_V2_MONEY_PAYOUT_COUNT')
  const payoutObject = await read(created[0][0], coinType, 'created'), payout = decodeCommerce(Coin, payoutObject.bytes)
  commerceCheck(payout.id === created[0][0] && payoutObject.object.owner.AddressOwner === receipt.receipt.beneficiary
    && payout.balance === receipt.receipt.price && BigInt(payout.balance) + fee === BigInt(receipt.receipt.total), 'PUBLIC_PAID_V2_MONEY_BENEFICIARY')
  const gas = await readSuiGasSettlement({ client, packet: saved.packet, effects: saved.effects, signal })
  const ledger = (object: typeof beforeObject, value: typeof before) => incomeLedgerWitness(value, {
    version: String(object.reference.version), digest: object.reference.digest,
  }, p.config.initialSharedVersion)
  return { format: 'native-public-read-v2' as const, proof: 'native-public-read-v2-original-coins-platform-income-gas-only' as const, transactionDigest: saved.packet.digest,
    buyer: p.buyer, coinType: normalizeStructTag(p.coinType), buyerGrossDebit: receipt.receipt.total, buyerChange: changeCoin.balance,
    payout: { coinId: payout.id, owner: receipt.receipt.beneficiary, amount: payout.balance }, protocolIncome: String(fee), platformLedger: { before: ledger(beforeObject, before), after: ledger(afterObject, after) }, gas,
    claimedEffectIds: [p.config.objectId, ref.objectId, payout.id, ...gas.gasCoinIds],
    requiresOriginalHostLinkPaidPointerAuthAndOfferProof: true as const, requiresOriginalPolicyProof: true as const, notCompleteSubscriptionProof: true as const,
    notContentDeliveryProof: true as const, notCurrentBalances: true as const }
}
