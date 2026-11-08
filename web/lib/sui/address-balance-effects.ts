import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'

/** Virtual accumulator writes live in original effects, not mutable latest
 * balance objects. Pinned Sui 2a0becb: accumulator_root::get_field_id,
 * AccumulatorWriteV1::merge and TemporaryStore::merge_accumulator_events keep
 * a touched zero-net Integer write as Merge(0), never an omitted coin object.
 * Caller must authenticate effects/finality and independently derive deltas. */
export function assertAddressBalanceEffects(input: {
  effects: ReturnType<typeof bcs.TransactionEffects.parse>; transactionDigest: string
  changes: Array<{ owner: string; coinType: string; delta: string; touched: boolean }>
}) {
  const { effects, transactionDigest, changes } = structuredClone(input), e = effects.V2
  function check(v: unknown, code: string): asserts v { if (!v) throw Error(`ADDRESS_BALANCE_EFFECTS_${code}`) }
  check(e?.status.$kind === 'Success' && e.transactionDigest === transactionDigest && changes.length <= 128
    && e.changedObjects.length <= 16384 && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length
    && e.unchangedConsensusObjects.every(([id]) => !e.changedObjects.some(([other]) => other === id)), 'CONTEXT')
  const expected = new Set<string>(), consumed = new Set<string>()
  for (const change of changes) {
    check(/^0x[0-9a-f]{64}$/.test(change.owner) && typeof change.touched === 'boolean'
      && /^(0|-?[1-9][0-9]{0,19})$/.test(change.delta), 'CHANGE')
    const coinType = normalizeStructTag(change.coinType), balanceType = normalizeStructTag(`0x2::balance::Balance<${coinType}>`)
    check(coinType === change.coinType, 'COIN_TYPE')
    const fieldId = deriveDynamicFieldID(normalizeSuiAddress('0xacc'), `0x2::accumulator::Key<${balanceType}>`, bcs.Address.serialize(change.owner).toBytes())
    check(!expected.has(fieldId), 'DUPLICATE_EXPECTATION'); expected.add(fieldId)
    const rows = e.changedObjects.filter(([id]) => id === fieldId), delta = BigInt(change.delta), amount = delta < 0n ? -delta : delta
    check(amount <= 18446744073709551615n && (change.touched || delta === 0n), 'DELTA')
    if (!change.touched) { check(rows.length === 0, 'UNEXPECTED_WRITE'); continue }
    const row = rows[0]?.[1], write = row?.outputState.AccumulatorWriteV1
    check(rows.length === 1 && row.inputState.$kind === 'NotExist' && row.idOperation.$kind === 'None' && write
      && write.address.address === change.owner && normalizeStructTag(write.address.ty) === balanceType
      && write.value.$kind === 'Integer' && write.value.Integer === String(amount)
      && write.operation.$kind === (delta < 0n ? 'Split' : 'Merge'), 'WRITE_MISMATCH')
    consumed.add(fieldId)
  }
  // This consumes ALL accumulator effects. Producers allowing other balance
  // recipients/assets or event streams must supply and verify those explicitly.
  check(e.changedObjects.every(([id, row]) => !row.outputState.AccumulatorWriteV1 || consumed.has(id)), 'EXTRA_ACCUMULATOR')
  return { proof: 'original-address-balance-effects-only' as const, transactionDigest, accumulatorIds: [...consumed],
    changes, notCurrentBalance: true as const }
}

/** Call after the original packet and its checkpoint-bound effects are authenticated. */
export function proveSuiAddressGas(input: {
  effects: ReturnType<typeof bcs.TransactionEffects.parse>; transactionDigest: string; owner: string; budget: string | number
}) {
  const { effects, transactionDigest, owner, budget } = input, e = effects.V2
  if (e?.gasObjectIndex !== null) throw Error('SUI_ADDRESS_GAS_EFFECTS_REQUIRED')
  const { computationCost, storageCost, storageRebate } = e.gasUsed
  const charge = BigInt(computationCost) + BigInt(storageCost) - BigInt(storageRebate)
  if (charge > BigInt(budget)) throw Error('SUI_ADDRESS_GAS_BUDGET')
  const proof = assertAddressBalanceEffects({ effects, transactionDigest, changes: [
    { owner, coinType: normalizeStructTag('0x2::sui::SUI'), delta: String(-charge), touched: true },
  ] })
  return { ...proof, owner, netGasCharge: String(charge), notBusinessReceipt: true as const }
}
