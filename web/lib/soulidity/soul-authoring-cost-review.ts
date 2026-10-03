import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import type { SoulAuthoringPacketRecord } from './soul-authoring-packet'

/** Presentation for a packet already checked by the production wallet adapter.
 * Read payments at their actual Walrus call sites, not every funding split
 * (which would double-count intermediate funding). Never requote another PTB. */
export function soulAuthoringCostReview(record: SoulAuthoringPacketRecord) {
  const data = Transaction.from(record.packet.bytes).getData()
  let wal = 0n
  for (const command of data.commands) {
    const call = command.MoveCall
    if (!call || call.module !== 'system' || !['reserve_space', 'register_blob'].includes(call.function)) continue
    const payment = call.arguments.at(-1)
    const result = payment?.$kind === 'NestedResult' ? payment.NestedResult
      : payment?.$kind === 'Result' ? [payment.Result, 0] : null
    const zero = result && data.commands[result[0]]?.MoveCall
    if (zero?.module === 'coin' && zero.function === 'zero' && zero.arguments.length === 0) continue
    const split = result && data.commands[result[0]]?.SplitCoins
    const amount = split && split.amounts[result![1]]
    const pure = amount?.$kind === 'Input' ? data.inputs[amount.Input]?.Pure : null
    if (!pure) throw new Error('Cannot display the exact storage payment; no wallet request was opened.')
    wal += BigInt(bcs.u64().parse(fromBase64(pure.bytes)))
  }
  if (!data.gasData.budget) throw new Error('The transaction has no gas budget.')
  return { digest: record.packet.digest, stage: record.plan.step.kind,
    gasBudgetMist: BigInt(data.gasData.budget), wal, sender: data.sender,
    expirationEpoch: record.packet.expirationEpoch }
}
