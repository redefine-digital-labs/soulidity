import { runPublicMutation, type PublicMutationAdapter, type PublicMutationRunParams } from '../sui/public-mutation-journal'
import { contentMutationKey, parseContentMutationRecord, type ContentMutationPlan,
  type ContentMutationRecord, type ContentMutationQuery } from './content-mutation-transaction'

export type ContentMutationAdapter = PublicMutationAdapter<ContentMutationPlan, ContentMutationRecord, ContentMutationQuery>
export interface ContentMutationRunResult extends ContentMutationQuery { record: ContentMutationRecord }

export function runContentMutation(
  params: PublicMutationRunParams<ContentMutationPlan, ContentMutationRecord, ContentMutationQuery>,
): Promise<ContentMutationRunResult> {
  return runPublicMutation(params, { key: contentMutationKey, parse: parseContentMutationRecord, errorPrefix: 'CONTENT_MUTATION_RUNNER' })
}
