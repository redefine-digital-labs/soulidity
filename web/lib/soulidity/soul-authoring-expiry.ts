import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toBase64 } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { validateMarketCancelCheckpoint, type MarketCancelCheckpoint } from '../animacraft/market-cancel-checkpoint'

/** Canonical executed checkpoint from the existing trusted ledger boundary,
 * not an independent BLS proof and not proof of past non-execution. The caller
 * MUST query the exact transaction after this read before retiring/replacing it. */
export async function readSoulAuthoringExpiry(client: SuiGrpcClient, expirationEpoch: string,
  signal: AbortSignal, saved?: MarketCancelCheckpoint): Promise<MarketCancelCheckpoint> {
  const check = (value: unknown) => { if (!value) throw new Error('SOUL_AUTHORING_EXPIRY_CHECKPOINT_UNCONFIRMED') }
  if (saved) validateMarketCancelCheckpoint(saved, expirationEpoch)
  const info = await profileReadStep(signal, () => client.ledgerService.getServiceInfo({}, { abort: signal }))
  check(info.response.chainId === MAINNET_GENESIS_DIGEST)
  const { response } = await profileReadStep(signal, () => client.ledgerService.getCheckpoint({
    checkpointId: saved ? { oneofKind: 'sequenceNumber', sequenceNumber: BigInt(saved.sequenceNumber) } : { oneofKind: undefined },
    readMask: { paths: ['sequence_number', 'digest', 'summary', 'signature'] },
  }, { abort: signal }))
  const checkpoint = response.checkpoint, summary = checkpoint?.summary
  check(checkpoint && summary?.bcs?.value && checkpoint.digest === summary.digest
    && typeof summary.epoch === 'bigint' && typeof summary.sequenceNumber === 'bigint'
    && checkpoint.sequenceNumber === summary.sequenceNumber && checkpoint.signature?.epoch === summary.epoch
    && checkpoint.signature.signature?.length === 48 && checkpoint.signature.bitmap?.length)
  const result = validateMarketCancelCheckpoint({ bytes: toBase64(summary!.bcs!.value!), digest: checkpoint!.digest,
    epoch: String(summary!.epoch), sequenceNumber: String(summary!.sequenceNumber) }, expirationEpoch)
  if (saved) check(result.bytes === saved.bytes && result.digest === saved.digest
    && result.sequenceNumber === saved.sequenceNumber && result.epoch === saved.epoch)
  signal.throwIfAborted(); return result
}
