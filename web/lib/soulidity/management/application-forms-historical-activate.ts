import { toHex } from '@mysten/sui/utils'
import { parseFormsManagementRecord } from './application-forms-record'
import { verifyFormsJournalMutation } from './application-forms-business'
import { applicationCapturedCompositionCommitment } from './application-recipe'
import { readFormsHistoricalActivationContent } from './application-forms-historical-activation-content'

/** Original ACTIVATE relation plus restored captured composition commitment.
 * Item conservation/custody, actual Composition revision and semantic renderer
 * outputs still require proof. Never returns PublicMutationQuery SUCCEEDED. */
export async function readFormsHistoricalActivate(input: Parameters<typeof readFormsHistoricalActivationContent>[0]) {
  const record = parseFormsManagementRecord(input.record)
  if (record.plan.action.kind !== 'ACTIVATE') throw Error('APPLICATION_FORMS_ACTIVATE_ACTIVATE_REQUIRED')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const evidence = await readFormsHistoricalActivationContent({ ...input, record, signal })
  if (evidence.status !== 'HISTORICAL_ACTIVATION_CONTENT_EVIDENCE') return evidence
  const relation = verifyFormsJournalMutation({ plan: record.plan, executedEpoch: evidence.effects.V2!.executedEpoch,
    before: evidence.before, after: evidence.after, beforeHead: evidence.beforeHead, afterHead: evidence.afterHead,
    transition: evidence.transition, snapshot: evidence.snapshot,
    applicationBefore: evidence.applicationBefore, applicationAfter: evidence.applicationAfter })
  const captured = applicationCapturedCompositionCommitment({ ...evidence.snapshot,
    sources: evidence.captured.sources, variants: evidence.captured.variants })
  if (toHex(captured) !== toHex(evidence.applicationAfter.recipe_hash)) throw Error('APPLICATION_FORMS_ACTIVATE_APPLIED_COMMITMENT')
  signal.throwIfAborted()
  return { ...evidence, status: 'HISTORICAL_ACTIVATE_RELATION_EVIDENCE' as const,
    journalTransitionVerified: relation.journalTransitionVerified, restoredCompositionCommitmentVerified: true as const,
    requiresOriginalCompositionOutputProof: true as const, requiresItemConservationProof: true as const,
    completeBusinessOutputVerified: false as const }
}
