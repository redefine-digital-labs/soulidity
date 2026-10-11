import { runPublicMutation, type PublicMutationAdapter, type PublicMutationRunParams } from '../sui/public-mutation-journal'
import { soulAccessKey, parseSoulAccessPlan, type SoulAccessPlan, type SoulAccessRecord, type SoulAccessQuery } from './soul-access-plan'
import { parseSoulAccessRecord } from './soul-access-operation'
import type { SoulAccessStore } from './soul-access-store'

export type SoulAccessAdapter = PublicMutationAdapter<SoulAccessPlan, SoulAccessRecord, SoulAccessQuery>
export function runSoulAccess(params: PublicMutationRunParams<SoulAccessPlan, SoulAccessRecord, SoulAccessQuery> & { store: SoulAccessStore }) {
  const plan = parseSoulAccessPlan(params.plan), expectedPacket = params.expectedPacket ? structuredClone(params.expectedPacket) : undefined
  const { startNew, queryOnly, cancelUnsigned, store, adapter } = params
  const d = plan.deployment, key = soulAccessKey(plan)
  // Callable/config namespaces keep exact deployment evidence distinct, but a
  // configuration change cannot permit a second unresolved payment for this
  // same Soul and author. All local access executions share this outer lock.
  const scope = `soulidity.soul-access-operation:${d.chainIdentifier}:${d.originalPackageId}:${plan.soulId}:${plan.author}`
  return store.exclusive(scope, async () => {
    if (startNew) {
      const others = store.discover({ soulId: plan.soulId, originalPackageId: d.originalPackageId })
        .filter(record => record.plan.author === plan.author && record.plan.deployment.chainIdentifier === d.chainIdentifier
          && soulAccessKey(record.plan) !== key)
      for (const record of others) {
        const result = await adapter.query(record)
        if (['SUCCEEDED', 'FAILED'].includes(record.packet.phase) && result.status !== record.packet.phase)
          throw new Error('SOUL_ACCESS_RUNNER_OTHER_DEPLOYMENT_RESULT_UNCONFIRMED')
        if (result.status !== 'SUCCEEDED' && result.status !== 'FAILED'
          && !(result.status === 'MISSING' && record.packet.phase === 'CANCELLED' && record.packet.signature === null))
          throw new Error('SOUL_ACCESS_RUNNER_OTHER_DEPLOYMENT_RECOVERY_REQUIRED')
      }
    }
    return runPublicMutation({ plan, expectedPacket, startNew, queryOnly, cancelUnsigned, store, adapter },
      { key: soulAccessKey, parse: parseSoulAccessRecord, errorPrefix: 'SOUL_ACCESS_RUNNER' })
  })
}
