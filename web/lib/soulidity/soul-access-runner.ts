import { assertSameSoulForeignHeads, captureSameSoulHeadPort, type SameSoulMutationHeadPort } from './same-soul-mutation-heads'
import { runPublicMutation, type PublicMutationAdapter, type PublicMutationRunParams } from '../sui/public-mutation-journal'
import { soulAccessKey, parseSoulAccessPlan, type SoulAccessPlan, type SoulAccessRecord, type SoulAccessQuery } from './soul-access-plan'
import { parseSoulAccessRecord } from './soul-access-operation'
import type { SoulAccessStore } from './soul-access-store'
import {withSoulAccessAssetLock} from './soul-access-asset-lock'
import {browserNativePublicReadPaidJournalV2,discoverNativePublicReadPaidAssetV2,nativePublicReadPaidHeadCanClearV2,type NativePublicReadPaidRecordV2} from './native-public-read-paid-journal-v2'

export type SoulAccessAdapter = PublicMutationAdapter<SoulAccessPlan, SoulAccessRecord, SoulAccessQuery> & {
  queryNativePublicReadPaid?(record:NativePublicReadPaidRecordV2):Promise<{status:string}>
}
export function runSoulAccess(params: PublicMutationRunParams<SoulAccessPlan, SoulAccessRecord, SoulAccessQuery> & { store: SoulAccessStore;adapter:SoulAccessAdapter; foreignHeads?:SameSoulMutationHeadPort; signal?:AbortSignal }) {
  const plan = parseSoulAccessPlan(params.plan), expectedPacket = params.expectedPacket ? structuredClone(params.expectedPacket) : undefined
  const foreignHeads = params.foreignHeads ? captureSameSoulHeadPort(params.foreignHeads) : undefined, signal = params.signal ?? new AbortController().signal
  const { startNew, queryOnly, cancelUnsigned, retireExpired, store, adapter } = params
  const d = plan.deployment, key = soulAccessKey(plan)
  // Callable/config namespaces keep exact deployment evidence distinct, but a
  // configuration change cannot permit a second unresolved payment for this
  // same Soul and author. All local access executions share this outer lock.
  const scope = `soulidity.soul-access-operation:${d.chainIdentifier}:${d.originalPackageId}:${plan.soulId}:${plan.author}`
  const asset={chainIdentifier:d.chainIdentifier,soulId:plan.soulId,author:plan.author}
  return withSoulAccessAssetLock(asset,()=>store.exclusive(scope, async () => {
    // The implicit no-startNew path may prepare/sign too. Every mutation path
    // excludes foreign originals; query/unsigned cancel retain recovery access.
    if (!queryOnly&&!cancelUnsigned) {
      if (foreignHeads) await assertSameSoulForeignHeads({ scopes:[asset], ownKeys:[key], signal, port:foreignHeads })
      const others = store.discoverAsset(asset).filter(record => soulAccessKey(record.plan) !== key)
      for (const record of others) {
        const result = await adapter.query(record)
        if (['SUCCEEDED', 'FAILED'].includes(record.packet.phase) && result.status !== record.packet.phase)
          throw new Error('SOUL_ACCESS_RUNNER_OTHER_DEPLOYMENT_RESULT_UNCONFIRMED')
        if (result.status !== 'SUCCEEDED' && result.status !== 'FAILED'
          && !(result.status === 'MISSING' && record.packet.phase === 'CANCELLED' && record.packet.signature === null))
          throw new Error('SOUL_ACCESS_RUNNER_OTHER_DEPLOYMENT_RECOVERY_REQUIRED')
      }
      const heads=await discoverNativePublicReadPaidAssetV2(browserNativePublicReadPaidJournalV2(),asset)
      for(const record of heads){
        if(!adapter.queryNativePublicReadPaid)throw Error('SOUL_ACCESS_RUNNER_V2_QUERY_REQUIRED')
        const result=await adapter.queryNativePublicReadPaid(structuredClone(record))
        if(!nativePublicReadPaidHeadCanClearV2(record,result))throw Error('SOUL_ACCESS_RUNNER_V2_RECOVERY_REQUIRED')
      }
    }
    return runPublicMutation({ plan, expectedPacket, startNew, queryOnly, cancelUnsigned, retireExpired, store, adapter },
      { key: soulAccessKey, parse: parseSoulAccessRecord, errorPrefix: 'SOUL_ACCESS_RUNNER' })
  }))
}
