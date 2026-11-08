import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64, toBase58 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { profileReadStep } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { readActivityCheckpointEvidence } from '../soulidity/activity-transaction-evidence'
import { check, uint, decode, collectionCommandHash, type CollectionCommandRecord, type CollectionCommandTarget } from './collection-command-plan'
import { collectionCommandChain } from './collection-command-state'
import { readCollectionGasWindow } from './collection-command-gas'

type Original = { plan: { author: string; target: CollectionCommandTarget }; packet: CollectionCommandRecord['packet'] }

const Digests = bcs.struct('ExecutionDigests', { transaction: bcs.byteVector(), effects: bcs.byteVector() })
const CheckpointSignatures = bcs.enum('CheckpointContents', {
  V1: bcs.struct('V1', { transactions: bcs.vector(Digests), user_signatures: bcs.vector(bcs.vector(bcs.byteVector())) }),
  V2: bcs.struct('V2', { transactions: bcs.vector(bcs.struct('Entry', { digest: Digests,
    user_signatures: bcs.vector(bcs.tuple([bcs.byteVector(), bcs.option(bcs.u64())])) })) }),
})

export async function verifyCollectionOriginalSignature(client: SuiGrpcClient, record: Original, signal: AbortSignal) {
  const { bytes, signature } = record.packet
  check(signature, 'SIGNATURE_REQUIRED')
  await profileReadStep(signal, () => verifyTransactionSignature(fromBase64(bytes), signature, { address: record.plan.author, client }))
}

// The caller parses the exact plan and bytes for its transaction kind first.
export async function readCollectionOriginalEvidence(client: SuiGrpcClient, r: Original, signal: AbortSignal) {
  const genesis = await collectionCommandChain(client, r.plan.target, signal)
  if (r.plan.target.chainIdentifier === '35834a8a') check(genesis === MAINNET_GENESIS_DIGEST, 'WRONG_MAINNET')
  const data = Transaction.from(fromBase64(r.packet.bytes)).getData()
  const { min, max } = readCollectionGasWindow(data, r.packet.expirationEpoch, r.plan.target.chainIdentifier, genesis)
  let response
  try { response = (await profileReadStep(signal, () => client.ledgerService.getTransaction({ digest: r.packet.digest,
    readMask: { paths: ['digest', 'transaction.digest', 'transaction.bcs', 'effects.bcs', 'effects.transaction_digest', 'effects.status', 'events.bcs', 'checkpoint'] },
  }, { abort: signal }))).response }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return { status: 'MISSING' as const }; throw error }
  // Keep status, effects digest and event bytes from one immutable response
  // snapshot across checkpoint/history awaits. A transport-owned buffer
  // must not rebind a previously decoded Success to different effects.
  const value = structuredClone(response.transaction)
  check(value?.digest === r.packet.digest && value.transaction?.digest === r.packet.digest && value.transaction.bcs?.value
    && toBase64(value.transaction.bcs.value) === r.packet.bytes && value.effects?.transactionDigest === r.packet.digest
    && value.effects.bcs?.value && value.effects.bcs.value.length > 0 && value.effects.bcs.value.length <= 1024 * 1024, 'TRANSACTION_EVIDENCE')
  const effects = decode(bcs.TransactionEffects, value.effects.bcs.value), e = effects.V2
  check(e && e.transactionDigest === r.packet.digest && ['Success', 'Failure'].includes(e.status.$kind)
    && value.effects.status?.success === (e.status.$kind === 'Success') && BigInt(e.executedEpoch) >= min && BigInt(e.executedEpoch) <= max, 'EFFECTS_STATUS')
  if (value.checkpoint === undefined) return { status: 'PENDING' as const }
  uint(String(value.checkpoint)); const checkpoint = String(value.checkpoint)
  const evidence = await readActivityCheckpointEvidence({ client, chainIdentifier: r.plan.target.chainIdentifier, checkpoint, signal })
  const membership = evidence.transactions.filter(row => row.transactionDigest === r.packet.digest)
  check(membership.length === 1 && membership[0].effectsDigest === collectionCommandHash('TransactionEffects', value.effects.bcs.value)
    && evidence.epoch === e.executedEpoch, 'CHECKPOINT_MEMBERSHIP')
  const contents = decode(CheckpointSignatures, fromBase64(evidence.contentsBytes))
  const index = evidence.transactions.findIndex(row => row.transactionDigest === r.packet.digest)
  const committed = contents.V1 ? contents.V1.user_signatures[index] : contents.V2!.transactions[index].user_signatures.map(row => row[0])
  const committedDigest = contents.V1 ? contents.V1.transactions[index] : contents.V2!.transactions[index].digest
  check(toBase58(committedDigest.transaction) === r.packet.digest && committed.length === 1
    && (r.packet.signature === null || toBase64(committed[0]) === r.packet.signature), 'CHECKPOINT_SIGNATURE')
  await verifyCollectionOriginalSignature(client, { ...r, packet: { ...r.packet, signature: toBase64(committed[0]) } }, signal)
  if (e.status.$kind === 'Failure') return { status: 'FAILED' as const, checkpoint }
  check(value.events?.bcs?.value instanceof Uint8Array, 'RAW_EVENTS_REQUIRED')
  signal.throwIfAborted()
  return { status: 'SUCCEEDED' as const, checkpoint, effects, events: value.events.bcs.value }
}
