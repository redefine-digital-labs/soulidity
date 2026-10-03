import { createPublicMutationStore, type PublicMutationStore } from '../sui/public-mutation-journal'
import { soulAccessKey, type SoulAccessPlan, type SoulAccessRecord } from './soul-access-plan'
import { parseSoulAccessRecord } from './soul-access-operation'

export const SOUL_ACCESS_STORE_CHANGED = 'soulidity:soul-access-store-changed'
export type SoulAccessStore = PublicMutationStore<SoulAccessPlan, SoulAccessRecord>
export function browserSoulAccessStore(): SoulAccessStore {
  return createPublicMutationStore({ prefix: 'soulidity.soul-access:', changedEvent: SOUL_ACCESS_STORE_CHANGED,
    errorPrefix: 'SOUL_ACCESS_STORE', parse: parseSoulAccessRecord, key: soulAccessKey })
}
