import { bcs } from '@mysten/sui/bcs'
import { toBase64 } from '@mysten/sui/utils'
import type { HistoricalExecutionContextV1 } from '../../sui/historical-execution-frame-v1'

const Events = bcs.vector(bcs.struct('Event', { package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
  type_: bcs.StructTag, contents: bcs.byteVector() }))
/** Authenticated execution bytes, with explicitly unqualified decoded facts.
 * No payment/authority/current-balance conclusion is derived from this export.
 */
export function incomeOriginalExecutionFacts(context: HistoricalExecutionContextV1, events: Uint8Array) {
  let decodedEvents: { status: 'DECODED_UNQUALIFIED'; events: ReturnType<typeof Events.parse> } | { status: 'UNAVAILABLE' }
  try {
    const decoded = Events.parse(events)
    decodedEvents = decoded.length <= 4096 && toBase64(Events.serialize(decoded).toBytes()) === toBase64(events)
      ? { status: 'DECODED_UNQUALIFIED', events: decoded } : { status: 'UNAVAILABLE' }
  } catch { decodedEvents = { status: 'UNAVAILABLE' } }
  return { transactionDigest: context.transactionDigest, transactionBytes: context.transactionBytes,
    effectsBytes: toBase64(bcs.TransactionEffects.serialize(context.effects).toBytes()), eventsBytes: toBase64(events),
    genesisDigest: context.genesisDigest, checkpoint: context.checkpoint, epoch: context.effects.V2!.executedEpoch,
    executionStatus: 'SUCCESS' as const, decodedEvents, completeBusinessOutputVerified: false as const }
}
