import type { NativeCompleteReadTarget } from './native-complete-read-types'

/** Browser-safe, current DF10 equipment metadata. Never an entitlement by itself. */
interface NativeEquipmentReadCommon {
  schema: 'native-equipment-read-v1'
  soulId: string
  stateId: string
  owner: string
  ownershipEpoch: string
  bindingId: string
  rootId: string
  protocolConfigId: string
  catalogId: string
  releaseConfigId: string
  sealRegistryId: string
  sealPolicyId: string
  paymentCoinType: string
  loadoutId: string
  loadoutRevision: string
  loadoutCommitment: string
  runtimeDefinitionsId: string
  baseRegistryId: string
  packRegistryId: string
  makerAccessId: string
  selectionIndex: number
  slot: {
    partKey: string; itemKey: string; styleKey: string
    colorChannelKey: string | null; swatchKey: string | null; layerTrackKey: string
    sourceClass: 0 | 1; sourceDefinitionId: string; sourceSemanticId: string
    accessSubject: string; sourceEpoch: string; pricingCommitment: string
    assetContentCommitment: string; sealBindingCommitment: string
  }
  release: NativeCompleteReadTarget['release']
  ciphertext: NativeCompleteReadTarget['ciphertext'] & {
    ciphertextBlobCommitment: string
    certificationCommitment: string
  }
  policy: NativeCompleteReadTarget['policy']
}

export type NativeEquipmentReadTarget = NativeEquipmentReadCommon & (
  | { kind: 'base'; ownedBaseItemId?: never; packReleaseId?: never; packPassId?: never }
  | { kind: 'owned-base'; ownedBaseItemId: string; packReleaseId?: never; packPassId?: never }
  | { kind: 'pack'; ownedBaseItemId?: never; packReleaseId: string; packPassId: string }
)
