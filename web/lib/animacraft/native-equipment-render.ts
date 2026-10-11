import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { NativeReceiveTarget } from './native-receive'
import { NativeReceiveError } from './native-receive'
import { readNativeEquipment } from './native-equipment'
import { readNativeRenderSource, NativeRenderReadSet } from './native-render-source'
import { resolveNativeRenderScene } from './native-render-scene'
import type { NativeEquipmentRenderTarget } from './native-equipment-render-types'
import { nativeArtworkHex } from './native-artwork-bytes'
import { assertNativeSceneVisibility } from './native-visibility'

/** Current DF10 equipment only, never a complete Soul appearance or original
 * layer entitlement. The shared readset spans chain reads AND manifest awaits. */
export async function readNativeEquipmentRenderTarget(client: SuiGrpcClient, target: NativeReceiveTarget,
  input: { soulId: string; stateId: string }, signal?: AbortSignal): Promise<NativeEquipmentRenderTarget> {
  input = structuredClone(input)
  signal?.throwIfAborted()
  const reads = new NativeRenderReadSet(client)
  try {
    const current = await readNativeEquipment(client, target, input, reads)
    signal?.throwIfAborted()
    const identity = { schema: 'native-equipment-render-v1' as const, scope: 'CURRENT_EQUIPMENT_ONLY' as const,
      soulId: current.soulId, stateId: current.stateId, rootId: current.rootId,
      owner: current.owner, ownershipEpoch: current.ownershipEpoch }
    if (current.status === 'NOT_CREATED') return { ...identity, status: 'NOT_CREATED', snapshot: null, selectionIndexes: [], scene: null }
    const { loadout } = current.equipment
    const snapshot = { loadoutId: loadout.id, loadoutRevision: loadout.revision,
      loadoutCommitment: nativeArtworkHex(loadout.commitment) }
    const selectionIndexes = loadout.selections.flatMap((row, index) => row ? [index] : [])
    if (selectionIndexes.length === 0) return { ...identity, status: 'EMPTY', snapshot, selectionIndexes: [], scene: null }
    const source = await readNativeRenderSource(client, target, { rootId: loadout.root_id,
      makerVersion: loadout.root_version, rootCommitment: loadout.root_content_commitment,
      selections: loadout.selections }, { readSet: reads, signal })
    signal?.throwIfAborted()
    const scene = await resolveNativeRenderScene(source, { signal })
    assertNativeSceneVisibility(scene)
    if (scene.selectionIndexes.length !== selectionIndexes.length
      || scene.selectionIndexes.some((slot, index) => slot !== selectionIndexes[index])
      || JSON.stringify(scene.selections) !== JSON.stringify(loadout.selections)) {
      throw new NativeReceiveError('NATIVE_EQUIPMENT_RENDER_INVALID', 'Current equipment scene slot mismatch')
    }
    return { ...identity, status: 'AVAILABLE', snapshot, selectionIndexes, scene }
  } finally {
    await reads.verify()
    signal?.throwIfAborted()
  }
}
