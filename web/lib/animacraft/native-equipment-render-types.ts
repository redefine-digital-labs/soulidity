import type { ResolvedMakerV8Layer } from '@soulidity/animacraft-render-core'
import type { NativeVisibilityScene } from './native-visibility'

/** Browser-safe content metadata; no access proof, plaintext, or original/current merge. */
export interface NativeEquipmentRenderScene extends NativeVisibilityScene {
  schemaVersion: 'soulidity.native-render-scene.v1'
  rootId: string
  makerVersion: string
  rootContentCommitment: string
  document: { canvas: { width: number; height: number; pixelMode: 'smooth' | 'pixelated' } }
  layers: ResolvedMakerV8Layer[]
}
interface EquipmentRenderIdentity {
  schema: 'native-equipment-render-v1'
  scope: 'CURRENT_EQUIPMENT_ONLY'
  soulId: string
  stateId: string
  rootId: string
  owner: string
  ownershipEpoch: string
}
export interface NativeEquipmentRenderSnapshot {
  loadoutId: string
  loadoutRevision: string
  loadoutCommitment: string
}
export type NativeEquipmentRenderTarget = EquipmentRenderIdentity & (
  | { status: 'NOT_CREATED'; snapshot: null; selectionIndexes: []; scene: null }
  | { status: 'EMPTY'; snapshot: NativeEquipmentRenderSnapshot; selectionIndexes: []; scene: null }
  | { status: 'AVAILABLE'; snapshot: NativeEquipmentRenderSnapshot; selectionIndexes: number[]; scene: NativeEquipmentRenderScene }
)
