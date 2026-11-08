import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { parseEquipmentManagementRecord, verifyEquipmentManagementSignature } from './equipment-record'
import { readEquipmentHistoricalSlot } from './equipment-historical-slot'
import { readEquipmentHistoricalRootApplication } from './equipment-historical-root-application'
import { readEquipmentHistoricalItems } from './equipment-historical-items'
import { readEquipmentFinalizedExecution } from './equipment-execution'

/** Portable query-only original-byte recovery. Local terminal phase, current
 * wallet, current ABI and current owner cannot replace original chain evidence.
 * No journal replacement, packet rebuilding, signing or broadcast is performed. */
export async function queryEquipmentOriginalOperation(input: {
  client: SuiGrpcClient; text: string; soulId: string; chainIdentifier: string; signal: AbortSignal; includeItemEvidence?: boolean; historicalContext?: { standardTypeOrigin: string; compositionId?: string; maxHops?: number }
}) {
  if (!input.text.length || input.text.length > 300000) throw Error('MANAGEMENT_EQUIPMENT_RECOVERY_SIZE')
  const record = parseEquipmentManagementRecord(JSON.parse(input.text))
  if (record.plan.soulId !== input.soulId || record.plan.target.chainIdentifier !== input.chainIdentifier) throw Error('MANAGEMENT_EQUIPMENT_RECOVERY_SCOPE')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  signal.throwIfAborted()
  if (record.packet.signature !== null) await verifyEquipmentManagementSignature(record, input.client)
  signal.throwIfAborted()
  const slotEvidence=input.historicalContext?.compositionId?await readEquipmentHistoricalSlot({client:input.client,record,signal,standardTypeOrigin:input.historicalContext.standardTypeOrigin,compositionId:input.historicalContext.compositionId,maxHops:input.historicalContext.maxHops}):null
  const rootEvidence=slotEvidence??(input.historicalContext?await readEquipmentHistoricalRootApplication({client:input.client,record,signal,standardTypeOrigin:input.historicalContext.standardTypeOrigin}):null)
  const historical = rootEvidence ?? (input.includeItemEvidence ? await readEquipmentHistoricalItems({client:input.client,record,signal}) : null)
  const execution = historical?.execution ?? await readEquipmentFinalizedExecution({ client: input.client, record, signal })
  signal.throwIfAborted()
  return { digest: record.packet.digest, originalAuthor: record.plan.author, originalAction: record.plan.action.kind,
    originalSignatureVerified: record.packet.signature !== null, execution, itemEvidence:historical?.items??null, rootApplicationEvidence:rootEvidence?.rootApplication??null, slotEvidence:slotEvidence?.slot??null,
    businessOutputVerified: false as const, queryOnly: true as const }
}
