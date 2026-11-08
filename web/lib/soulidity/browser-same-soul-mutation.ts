import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { SoulAccessAssetScope } from './soul-access-asset-lock'
import { sameSoulMutationScope, withSameSoulMutations } from './same-soul-mutation-coordination'
import { captureSameSoulMarketExecutionClient } from './same-soul-mutation-client'
import { assertSameSoulForeignHeads, createBrowserSameSoulHeadPort } from './same-soul-mutation-heads'

/** Actual first-party browser Host bridge. Construct synchronously before any
 * new lock/query await, then construct the original domain adapter with client.
 * Neither parser nor query factory can be replaced through a UI callback.
 */
export function createBrowserSameSoulMutation(input: {
  client: SuiGrpcClient; scopes: readonly SoulAccessAssetScope[]; ownKeys: readonly string[]
  signal: AbortSignal; guard: () => void; recoveryOnly: boolean
}) {
  const signal = input.signal, guard = input.guard.bind(input), recoveryOnly = input.recoveryOnly
  const scopes = input.scopes.map(sameSoulMutationScope), ownKeys = input.ownKeys.slice()
  const client = captureSameSoulMarketExecutionClient(input.client, signal), headPort = createBrowserSameSoulHeadPort(client, undefined, signal)
  return Object.freeze({ client, async run<T>(work: () => Promise<T>): Promise<T> {
    guard(); signal.throwIfAborted()
    if (recoveryOnly) return work()
    return withSameSoulMutations({ scopes, signal }, async () => {
      guard(); await assertSameSoulForeignHeads({ scopes, ownKeys, signal, port: headPort }); guard()
      return work()
    })
  } })
}
