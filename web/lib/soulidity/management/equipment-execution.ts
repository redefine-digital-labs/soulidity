import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readFinalizedMutation } from '../../sui/finalized-mutation'
import { parseEquipmentManagementRecord, type EquipmentManagementRecord } from './equipment-record'

/** Original transaction/effects/checkpoint membership only. The deliberately
 * distinct FINALIZED_EXECUTION status cannot be used as PublicMutationQuery
 * SUCCEEDED: the Equipment historical business outputs must still be verified.
 * Query recovery does not require current ABI, wallet or mutable live state. */
export async function readEquipmentFinalizedExecution(input: {
  client: SuiGrpcClient; record: EquipmentManagementRecord; signal: AbortSignal
}) {
  const record = parseEquipmentManagementRecord(input.record)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45000)])
  const observed = await readFinalizedMutation({ client: input.client, packet: record.packet,
    chainIdentifier: record.plan.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal,
    errorPrefix: 'MANAGEMENT_EQUIPMENT_EXECUTION',
    proveSuccess: async context => ({ effects: context.effects, events: context.events }),
  })
  signal.throwIfAborted()
  if (observed.status !== 'SUCCEEDED') return observed
  return { status: 'FINALIZED_EXECUTION' as const, checkpoint: observed.checkpoint,
    transactionDigest: record.packet.digest, effects: observed.receipt.effects, events: observed.receipt.events,
    businessOutputVerified: false as const }
}
