import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { parseFormsManagementRecord, verifyFormsManagementSignature } from './application-forms-record'
import { readFormsFinalizedExecution } from './application-forms-execution'

/** Portable query-only original-byte recovery. Local terminal phase, current
 * wallet, current ABI and current owner cannot replace original chain evidence.
 * No journal replacement, packet rebuilding, signing or broadcast is performed. */
export async function queryFormsOriginalOperation(input: {
  client: SuiGrpcClient; text: string; soulId: string; chainIdentifier: string; signal: AbortSignal
}) {
  if (!input.text.length || input.text.length > 300000) throw Error('APPLICATION_FORMS_RECOVERY_SIZE')
  const record = parseFormsManagementRecord(JSON.parse(input.text))
  if (record.plan.soulId !== input.soulId || record.plan.target.chainIdentifier !== input.chainIdentifier) throw Error('APPLICATION_FORMS_RECOVERY_SCOPE')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  signal.throwIfAborted()
  if (record.packet.signature !== null) await verifyFormsManagementSignature(record, input.client)
  signal.throwIfAborted()
  const execution = await readFormsFinalizedExecution({ client: input.client, record, signal })
  signal.throwIfAborted()
  return { digest: record.packet.digest, originalAuthor: record.plan.author, originalAction: record.plan.action.kind,
    originalSignatureVerified: record.packet.signature !== null, execution,
    businessOutputVerified: false as const, queryOnly: true as const }
}
