import { bcs } from '@mysten/sui/bcs'
import { fromBase64, toBase64, toBase58 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'

export interface MarketCancelCheckpoint { bytes: string; digest: string; epoch: string; sequenceNumber: string }
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const byteVector = (length: number) => bcs.vector(bcs.u8()).transform({
  input: (bytes: number[]) => { check(bytes.length === length, 'Invalid checkpoint fixed byte length'); return bytes },
  output: bytes => { check(bytes.length === length, 'Invalid checkpoint fixed byte length'); return bytes },
})
const Digest = byteVector(32)
const Commitment = bcs.enum('CheckpointCommitment', { ECMHLiveObjectSetDigest: Digest, CheckpointArtifactsDigest: Digest })
// Exact sui_types::messages_checkpoint::CheckpointSummary, including the final
// epoch variant. Digests and validator public keys use byte vectors, not arrays.
export const MarketCancelCheckpointSummaryBcs = bcs.struct('CheckpointSummary', {
  epoch: bcs.u64(), sequence_number: bcs.u64(), network_total_transactions: bcs.u64(), content_digest: Digest,
  previous_digest: bcs.option(Digest), epoch_rolling_gas_cost_summary: bcs.struct('GasCostSummary', {
    computation_cost: bcs.u64(), storage_cost: bcs.u64(), storage_rebate: bcs.u64(), non_refundable_storage_fee: bcs.u64(),
  }), timestamp_ms: bcs.u64(), checkpoint_commitments: bcs.vector(Commitment),
  end_of_epoch_data: bcs.option(bcs.struct('EndOfEpochData', {
    next_epoch_committee: bcs.vector(bcs.tuple([byteVector(96),bcs.u64()])), next_epoch_protocol_version: bcs.u64(),
    epoch_commitments: bcs.vector(Commitment),
  })), version_specific_data: bcs.vector(bcs.u8()),
})
export function marketCancelCheckpointDigest(bytes: Uint8Array) {
  const prefix = new TextEncoder().encode('CheckpointSummary::')
  return toBase58(blake2b(new Uint8Array([...prefix,...bytes]), { dkLen: 32 }))
}
/** Validates canonical evidence and strict expiry, NOT a validator BLS quorum.
 * The live adapter obtains latest highest-executed VerifiedCheckpoint through
 * the existing trusted Mainnet RPC boundary. A later epoch rules out future
 * execution; it does not assert the transaction never executed in the past. */
export function validateMarketCancelCheckpoint(value: unknown, expirationEpoch: string): MarketCancelCheckpoint {
  const checkpoint = structuredClone(value) as MarketCancelCheckpoint
  check(checkpoint && typeof checkpoint.bytes === 'string' && checkpoint.bytes.length > 0 && checkpoint.bytes.length <= 90_000,
    'Invalid cancellation checkpoint bytes')
  const bytes = fromBase64(checkpoint.bytes)
  check(bytes.length <= 65_536 && toBase64(bytes) === checkpoint.bytes, 'Invalid cancellation checkpoint encoding')
  const summary = MarketCancelCheckpointSummaryBcs.parse(bytes)
  check(toBase64(MarketCancelCheckpointSummaryBcs.serialize(summary).toBytes()) === checkpoint.bytes
    && marketCancelCheckpointDigest(bytes) === checkpoint.digest
    && summary.epoch === checkpoint.epoch && summary.sequence_number === checkpoint.sequenceNumber,
  'Cancellation checkpoint evidence mismatch')
  check(/^(0|[1-9][0-9]{0,19})$/.test(expirationEpoch) && BigInt(expirationEpoch) <= 18446744073709551615n
    && BigInt(summary.epoch) > BigInt(expirationEpoch), 'Cancellation expiry requires a strictly later executed checkpoint epoch')
  return checkpoint
}
