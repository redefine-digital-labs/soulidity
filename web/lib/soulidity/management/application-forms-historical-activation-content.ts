import { readFormsHistoricalActivationSave } from './application-forms-historical-activation-save'
import { readHistoricalSnapshotCreatedContent } from './application-forms-historical-snapshot-content'
import { parseFormsManagementRecord } from './application-forms-record'

/** Read immutable content at its original creation transaction, after proving
 * the original SAVE append and its lineage to this ACTIVATE transaction.
 * Current head, current owner and latest content are never substituted. */
export async function readFormsHistoricalActivationContent(input: Parameters<typeof readFormsHistoricalActivationSave>[0]) {
  const record = parseFormsManagementRecord(input.record)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const evidence = await readFormsHistoricalActivationSave({ ...input, record, signal })
  if (evidence.status !== 'HISTORICAL_ACTIVATION_SAVE_TRANSITION_EVIDENCE') return evidence
  const captured = await readHistoricalSnapshotCreatedContent({ client: input.client, effects: evidence.snapshotWriter.effects,
    transactionDigest: evidence.snapshotWriter.transactionDigest, snapshot: evidence.snapshot,
    applicationOrigin: record.plan.target.application.originalPackageId, modelOrigin: record.plan.target.model.originalPackageId, signal })
  signal.throwIfAborted()
  return { ...evidence, status: 'HISTORICAL_ACTIVATION_CONTENT_EVIDENCE' as const, captured,
    snapshotCommitmentVerified: true as const, semanticRecipeQualified: false as const,
    requiresItemConservationProof: true as const, completeBusinessOutputVerified: false as const }
}
