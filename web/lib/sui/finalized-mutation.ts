import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { profileReadStep } from '@soulidity/sdk'
import { readActivityCheckpointEvidence, type ActivityCheckpointTransactionRef } from '../soulidity/activity-transaction-evidence'
import { readEpochExpiry } from './epoch-expiry'
import type { EpochCheckpoint } from './epoch-checkpoint'
import type { PublicMutationPacket } from './public-mutation-journal'
export interface FinalizedMutationContext {
 effects: ReturnType<typeof bcs.TransactionEffects.parse>; events: Uint8Array; checkpoint: string; checkpointProof: ActivityCheckpointTransactionRef; signal: AbortSignal
}
function typedHash(domain: string, bytes: Uint8Array) {
  const prefix = new TextEncoder().encode(`${domain}::`), input = new Uint8Array(prefix.length + bytes.length)
  input.set(prefix); input.set(bytes, prefix.length); return toBase58(blake2b(input, { dkLen: 32 }))
}
/** Trusted-ledger canonical bytes/checkpoint evidence only. Domain callers
 * parse their frozen packets and must prove every business output on success.
 * No signature, broadcaster, store mutation or permissive success default. */
export async function readFinalizedMutation<T>(params: {
 client: SuiGrpcClient; packet: PublicMutationPacket; retirementCheckpoint?: EpochCheckpoint
 minimumExecutionEpoch?: string
 chainIdentifier: string; genesisDigest: string; signal: AbortSignal; errorPrefix: string
 proveSuccess: (input: FinalizedMutationContext) => Promise<T>
}): Promise<{ status: 'MISSING' | 'PENDING' } | { status: 'FAILED'; checkpoint: string }
 | { status: 'SUCCEEDED'; checkpoint: string; receipt: T }> {
  const { client, signal, proveSuccess } = params, packet = structuredClone(params.packet)
  const retirementCheckpoint = params.retirementCheckpoint && structuredClone(params.retirementCheckpoint)
  const { chainIdentifier, genesisDigest, errorPrefix, minimumExecutionEpoch } = params
  function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`${errorPrefix}_${code}`) }
  if (retirementCheckpoint) await readEpochExpiry(client, packet.expirationEpoch, signal, genesisDigest, retirementCheckpoint)
  check(typeof proveSuccess === 'function', 'BUSINESS_VERIFIER_REQUIRED')
  const info = await profileReadStep(signal, () => client.ledgerService.getServiceInfo({}, { abort: signal }))
  check(info.response.chainId === genesisDigest, 'CHAIN_MISMATCH')
  let response
  try {
    response = (await profileReadStep(signal, () => client.ledgerService.getTransaction({ digest: packet.digest,
      readMask: { paths: ['digest', 'transaction.digest', 'transaction.bcs', 'effects.bcs', 'effects.transaction_digest',
        'effects.status', 'events.bcs', 'checkpoint'] } }, { abort: signal }))).response
  } catch (error) {
    signal.throwIfAborted()
    if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return { status: 'MISSING' }
    throw error
  }
  const row = structuredClone(response.transaction)
  check(!retirementCheckpoint, 'RETIRED_TRANSACTION_FOUND')
  check(row?.digest === packet.digest && row.transaction?.digest === packet.digest
    && row.transaction.bcs?.value instanceof Uint8Array && toBase64(row.transaction.bcs.value) === packet.bytes
    && row.effects?.transactionDigest === packet.digest && row.effects.bcs?.value instanceof Uint8Array
    && row.effects.bcs.value.length > 0 && row.effects.bcs.value.length <= 1024 * 1024, 'RAW_TRANSACTION_REQUIRED')
  const rawEffects = row.effects.bcs.value, effects = bcs.TransactionEffects.parse(rawEffects), e = effects.V2
  check(toBase64(bcs.TransactionEffects.serialize(effects).toBytes()) === toBase64(rawEffects)
    && e && e.transactionDigest === packet.digest && ['Success', 'Failure'].includes(e.status.$kind)
    && row.effects.status?.success === (e.status.$kind === 'Success')
    && BigInt(e.executedEpoch) <= BigInt(packet.expirationEpoch)
    && (minimumExecutionEpoch === undefined || BigInt(e.executedEpoch) >= BigInt(minimumExecutionEpoch)), 'RAW_EFFECTS_MISMATCH')
  if (row.checkpoint === undefined) return { status: 'PENDING' }
  check(row.checkpoint >= 0n, 'CHECKPOINT_INVALID')
  const checkpoint = String(row.checkpoint)
  const evidence = await readActivityCheckpointEvidence({ client, signal,
    chainIdentifier, checkpoint })
  const matches = evidence.transactions.filter(tx => tx.transactionDigest === packet.digest)
  check(matches.length === 1 && matches[0].effectsDigest === typedHash('TransactionEffects', rawEffects)
    && evidence.epoch === e.executedEpoch, 'CHECKPOINT_MEMBERSHIP')
  signal.throwIfAborted()
  if (e.status.$kind === 'Failure') return { status: 'FAILED', checkpoint }
  const rawEvents = row.events?.bcs?.value
  let events: Uint8Array
  if (e.eventsDigest === null) {
    // Protocol-valid eventless success. Do not fabricate an event digest or
    // weaken the mandatory domain output proof. The empty vector is only the
    // consumer representation of authenticated absence in original effects.
    check(rawEvents === undefined && row.events?.digest === undefined
      && !(row.events?.events?.length), 'EVENTLESS_CONTRADICTION')
    events = new Uint8Array([0])
  } else {
    check(rawEvents instanceof Uint8Array && rawEvents.length > 0 && rawEvents.length <= 1024 * 1024
      && e.eventsDigest === typedHash('TransactionEvents', rawEvents), 'EVENTS_DIGEST')
    events = new Uint8Array(rawEvents)
  }
  const receipt = await profileReadStep(signal, () => proveSuccess({ effects,
    events: new Uint8Array(events), checkpoint, checkpointProof: { checkpoint, digest: evidence.digest, effectsDigest: matches[0].effectsDigest }, signal }))
  signal.throwIfAborted()
  return { status: 'SUCCEEDED', checkpoint, receipt }
}
