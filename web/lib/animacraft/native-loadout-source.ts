import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { NativeReceiveTarget } from './native-receive'
import type { NamedLoadoutContent } from './named-loadout'
import { readNativeEquipment } from './native-equipment'

/** Exact references are discovery keys only. All original source/custody checks
 * and the final shared optimistic read-set verification remain mandatory. */
export function readNativeLoadoutSource(client: SuiGrpcClient, target: NativeReceiveTarget,
  input: { soulId: string; stateId: string; content: NamedLoadoutContent }) {
  return readNativeEquipment(client, target, { soulId: input.soulId, stateId: input.stateId, loadoutContent: input.content })
}
