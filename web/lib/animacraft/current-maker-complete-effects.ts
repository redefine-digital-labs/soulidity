import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { profileReadStep } from '@soulidity/sdk'
import { readActivityCheckpointEvidence } from '../soulidity/activity-transaction-evidence'
import { parseCurrentCompletePacket, type CurrentCompletePacketRecord } from './current-maker-complete-packet'
const Events = bcs.struct('TransactionEvents', { data: bcs.vector(bcs.struct('Event', {
  package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address, type_: bcs.StructTag, contents: bcs.byteVector(),
})) })
const hash = (domain: string, bytes: Uint8Array) => toBase58(blake2b(new Uint8Array([...new TextEncoder().encode(`${domain}::`), ...bytes]), { dkLen: 32 }))
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`CURRENT_COMPLETE_EFFECTS_${code}`) }
/** Original finalized execution observation only. Proves exact tx/effects and
 * structural events under a trusted ledger checkpoint; not validator quorum,
 * package execution qualification, full business success/failure or delivery.
 * Never runs a current-state preflight or replaces a historical packet. */
export async function readCurrentCompleteFinalEffects(input: {
  record: CurrentCompletePacketRecord; client: SuiGrpcClient; signal: AbortSignal; isCurrent(): boolean
}) {
  const record = parseCurrentCompletePacket(input.record), { client, isCurrent } = input
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const guard = () => { signal.throwIfAborted(); check(isCurrent(), 'STALE') }
  guard()
  const { response } = await profileReadStep(signal, () => client.ledgerService.getTransaction({ digest: record.packet.digest,
    readMask: { paths: ['digest','transaction.digest','transaction.sender','transaction.bcs','effects.bcs','effects.transaction_digest','effects.status','events.bcs','checkpoint'] },
  }, { abort: signal })); guard()
  const row = structuredClone(response.transaction)
  check(row?.digest === record.packet.digest && row.transaction?.digest === record.packet.digest && row.transaction.sender === record.plan.actor
    && row.transaction.bcs?.value instanceof Uint8Array && toBase64(row.transaction.bcs.value) === record.packet.bytes, 'ORIGINAL_TRANSACTION')
  const raw = row.effects?.bcs?.value
  check(raw instanceof Uint8Array && raw.length > 0 && raw.length <= 1024 * 1024, 'RAW_EFFECTS')
  const effects = bcs.TransactionEffects.parse(raw), e = effects.V2
  check(toBase64(bcs.TransactionEffects.serialize(effects).toBytes()) === toBase64(raw) && e
    && e.transactionDigest === record.packet.digest && row.effects?.transactionDigest === record.packet.digest, 'EFFECTS_IDENTITY')
  check(['Success','Failure'].includes(e.status.$kind) && row.effects?.status?.success === (e.status.$kind === 'Success')
    && BigInt(e.executedEpoch) <= BigInt(record.packet.expirationEpoch), 'EXECUTION_STATUS')
  check(e.changedObjects.length <= 16384 && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length
    && new Set(e.unchangedConsensusObjects.map(([id]) => id)).size === e.unchangedConsensusObjects.length
    && e.unchangedConsensusObjects.every(([id]) => !e.changedObjects.some(([other]) => other === id)), 'OBJECT_LINEAGE')
  check(typeof row.checkpoint === 'bigint' && row.checkpoint >= 0n && row.checkpoint <= 18446744073709551615n, 'CHECKPOINT_REQUIRED')
  const checkpoint = await readActivityCheckpointEvidence({ client, chainIdentifier: toHex(fromBase58(record.plan.target.chainIdentifier).slice(0,4)), checkpoint: String(row.checkpoint), signal }); guard()
  const member = checkpoint.transactions.filter(value => value.transactionDigest === record.packet.digest)
  check(member.length === 1 && member[0].effectsDigest === hash('TransactionEffects', raw) && checkpoint.epoch === e.executedEpoch, 'CHECKPOINT_MEMBERSHIP')
  const eventBytes = row.events?.bcs?.value
  let events: ReturnType<typeof Events.parse>['data'] = []
  let encoded: Uint8Array = Events.serialize({ data: [] }).toBytes()
  if (eventBytes !== undefined) {
    check(eventBytes instanceof Uint8Array && eventBytes.length > 0 && eventBytes.length <= 1024 * 1024, 'EVENTS_BYTES')
    const parsed = Events.parse(eventBytes)
    check(toBase64(Events.serialize(parsed).toBytes()) === toBase64(eventBytes) && parsed.data.length <= 16384, 'EVENTS_ENCODING')
    check(parsed.data.every(event => event.sender === record.plan.actor), 'EVENT_SENDER')
    events = parsed.data; encoded = eventBytes
  }
  check(e.eventsDigest === null ? events.length === 0 : eventBytes !== undefined && e.eventsDigest === hash('TransactionEvents', eventBytes), 'EVENTS_DIGEST')
  return { authority: 'trusted-ledger-original-complete-effects-only' as const, transactionDigest: record.packet.digest,
    executionStatus: e.status.$kind === 'Success' ? 'SUCCESS' as const : 'FAILURE' as const, effects, events, eventBytes: new Uint8Array(encoded),
    checkpoint: checkpoint.checkpoint, checkpointTimestampMs: checkpoint.timestampMs, notDeliveryReceipt: true as const,
    requiresFullBusinessEffectsProof: true as const, notCurrentAuthority: true as const, executionPackageVersion: 'NOT_ATTESTED' as const, eventAuthority: 'STRUCTURAL_ONLY' as const }
}
