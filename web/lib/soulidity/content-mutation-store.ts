import { createPublicMutationStore, publicMutationCanonical, type PublicMutationListScope, type PublicMutationStore } from '../sui/public-mutation-journal'
import { contentMutationKey, parseContentMutationRecord, type ContentMutationPlan, type ContentMutationRecord } from './content-mutation-transaction'

export const CONTENT_MUTATION_STORE_CHANGED = 'soulidity:content-mutation-store-changed'
export type ContentMutationListScope = PublicMutationListScope<ContentMutationPlan>
export type ContentMutationStore = PublicMutationStore<ContentMutationPlan, ContentMutationRecord>
export const contentMutationCanonical = publicMutationCanonical

export function browserContentMutationStore(): ContentMutationStore {
  return createPublicMutationStore({ prefix: 'soulidity.content-mutation:', changedEvent: CONTENT_MUTATION_STORE_CHANGED,
    errorPrefix: 'CONTENT_MUTATION_STORE', parse: parseContentMutationRecord, key: contentMutationKey })
}
