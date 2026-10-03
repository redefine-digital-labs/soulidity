import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { profileReadStep } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { readActivityCheckpointEvidence } from './activity-transaction-evidence'
import { readSoulAuthoringExpiry } from './soul-authoring-expiry'
import { createSoulAuthoringPacketParser, soulAuthoringPacketCheck as check, type SoulAuthoringPacketRecord } from './soul-authoring-packet'
import { parseSoulAuthoringPreparation, type SoulAuthoringPreparation } from './soul-authoring-store'

export interface SoulAuthoringFinalTransaction {
  preparation: SoulAuthoringPreparation; record: SoulAuthoringPacketRecord
  effects: ReturnType<typeof bcs.TransactionEffects.parse>; events: Uint8Array; checkpoint: string; signal: AbortSignal
}
function typedHash(domain: string, bytes: Uint8Array) {
  const prefix = new TextEncoder().encode(`${domain}::`), input = new Uint8Array(prefix.length + bytes.length)
  input.set(prefix); input.set(bytes, prefix.length); return toBase58(blake2b(input, { dkLen: 32 }))
}
/** Raw finality is necessary but NOT sufficient for authoring success. No
 * default business verifier: success remains unavailable until the supplied
 * production verifier proves every manifest/slot/custody/bind/list output. */
export async function querySoulAuthoringPacket<T>(params: {
  client: SuiGrpcClient; preparation: SoulAuthoringPreparation; record: SoulAuthoringPacketRecord; signal: AbortSignal
  proveSuccess: (input: SoulAuthoringFinalTransaction) => Promise<T>
}): Promise<{ status: 'MISSING' | 'PENDING' } | { status: 'FAILED'; checkpoint: string }
  | { status: 'SUCCEEDED'; checkpoint: string; receipt: T }> {
  const preparation = parseSoulAuthoringPreparation(params.preparation)
  const record = createSoulAuthoringPacketParser(preparation).parse(params.record)
  const { client, signal, proveSuccess } = params
  if (record.retirement) await readSoulAuthoringExpiry(client, record.packet.expirationEpoch, signal, record.retirement.checkpoint)
  check(typeof proveSuccess === 'function', 'BUSINESS_VERIFIER_REQUIRED')
  const info = await profileReadStep(signal, () => client.ledgerService.getServiceInfo({}, { abort: signal }))
  check(info.response.chainId === MAINNET_GENESIS_DIGEST, 'CHAIN_MISMATCH')
  let response
  try {
    response = (await profileReadStep(signal, () => client.ledgerService.getTransaction({ digest: record.packet.digest,
      readMask: { paths: ['digest', 'transaction.digest', 'transaction.bcs', 'effects.bcs', 'effects.transaction_digest',
        'effects.status', 'events.bcs', 'checkpoint'] } }, { abort: signal }))).response
  } catch (error) {
    signal.throwIfAborted()
    if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return { status: 'MISSING' }
    throw error
  }
  const row = structuredClone(response.transaction), packet = record.packet
  check(!record.retirement, 'RETIRED_TRANSACTION_FOUND')
  check(row?.digest === packet.digest && row.transaction?.digest === packet.digest
    && row.transaction.bcs?.value instanceof Uint8Array && toBase64(row.transaction.bcs.value) === packet.bytes
    && row.effects?.transactionDigest === packet.digest && row.effects.bcs?.value instanceof Uint8Array
    && row.effects.bcs.value.length > 0 && row.effects.bcs.value.length <= 1024 * 1024, 'RAW_TRANSACTION_REQUIRED')
  const rawEffects = row.effects.bcs.value, effects = bcs.TransactionEffects.parse(rawEffects), e = effects.V2
  check(toBase64(bcs.TransactionEffects.serialize(effects).toBytes()) === toBase64(rawEffects)
    && e && e.transactionDigest === packet.digest && ['Success', 'Failure'].includes(e.status.$kind)
    && row.effects.status?.success === (e.status.$kind === 'Success')
    && BigInt(e.executedEpoch) <= BigInt(packet.expirationEpoch), 'RAW_EFFECTS_MISMATCH')
  if (row.checkpoint === undefined) return { status: 'PENDING' }
  check(row.checkpoint >= 0n, 'CHECKPOINT_INVALID')
  const checkpoint = String(row.checkpoint)
  const evidence = await readActivityCheckpointEvidence({ client, signal,
    chainIdentifier: preparation.manifest.request.target.chainIdentifier, checkpoint })
  const matches = evidence.transactions.filter(tx => tx.transactionDigest === packet.digest)
  check(matches.length === 1 && matches[0].effectsDigest === typedHash('TransactionEffects', rawEffects)
    && evidence.epoch === e.executedEpoch, 'CHECKPOINT_MEMBERSHIP')
  signal.throwIfAborted()
  if (e.status.$kind === 'Failure') return { status: 'FAILED', checkpoint }
  const events = row.events?.bcs?.value
  check(events instanceof Uint8Array && events.length > 0 && events.length <= 1024 * 1024
    && e.eventsDigest === typedHash('TransactionEvents', events), 'EVENTS_DIGEST')
  const receipt = await profileReadStep(signal, () => proveSuccess({ preparation, record, effects,
    events: new Uint8Array(events), checkpoint, signal }))
  signal.throwIfAborted()
  return { status: 'SUCCEEDED', checkpoint, receipt }
}
