import { fromHex } from '@mysten/sui/utils'
import { buildAnimacraftEquipmentReadApprovalV8 } from '@soulidity/sdk'
import type { NativeEquipmentReadTarget } from './native-equipment-read-types'
import { assertNativeSealReadMetadata, decryptNativeSealBytes, type NativeSealReadParams } from './native-complete-read-client'

const MAX_LAYER_BYTES = 3 * 1024 * 1024
export interface ExpectedNativeEquipmentRead {
  loadoutId: string; loadoutRevision: string; loadoutCommitment: string; ownershipEpoch: string
}
const id = (v: unknown) => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v)
const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
const u64 = (v: unknown) => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) && BigInt(v) <= 18446744073709551615n
const key = (v: unknown) => typeof v === 'string' && new TextEncoder().encode(v).length > 0
  && new TextEncoder().encode(v).length <= 128 && !/[\0/]/.test(v)
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

export function assertNativeEquipmentReadTarget(value: unknown, soulId: string, owner: string,
  selectionIndex: number, expected: ExpectedNativeEquipmentRead): NativeEquipmentReadTarget {
  check(id(expected?.loadoutId) && u64(expected?.loadoutRevision) && hash(expected?.loadoutCommitment)
    && u64(expected?.ownershipEpoch), 'Invalid expected equipment snapshot.')
  const v = structuredClone(value) as NativeEquipmentReadTarget
  check(v?.schema === 'native-equipment-read-v1' && v.soulId === soulId && v.owner === owner,
    'The connected wallet is not the current owner of this equipped layer.')
  check(Number.isInteger(selectionIndex) && selectionIndex >= 0 && selectionIndex < 500
    && v.selectionIndex === selectionIndex, 'The equipped layer slot changed. Please retry.')
  for (const field of ['soulId', 'stateId', 'owner', 'bindingId', 'rootId', 'protocolConfigId', 'catalogId',
    'releaseConfigId', 'sealRegistryId', 'sealPolicyId', 'loadoutId', 'runtimeDefinitionsId', 'baseRegistryId',
    'packRegistryId', 'makerAccessId'] as const) check(id(v[field]), 'Invalid equipped layer object identity.')
  check(v.loadoutId === expected.loadoutId && v.loadoutRevision === expected.loadoutRevision
    && v.loadoutCommitment === expected.loadoutCommitment && v.ownershipEpoch === expected.ownershipEpoch,
  'The equipment snapshot changed. Please retry.')
  const slot = v.slot
  check(slot && key(slot.partKey) && key(slot.itemKey) && key(slot.styleKey) && key(slot.layerTrackKey)
    && u64(slot.sourceEpoch) && id(slot.sourceDefinitionId) && id(slot.accessSubject)
    && hash(slot.pricingCommitment) && hash(slot.assetContentCommitment) && hash(slot.sealBindingCommitment),
  'Invalid equipped layer slot evidence.')
  check((slot.colorChannelKey === null && slot.swatchKey === null)
    || (key(slot.colorChannelKey) && key(slot.swatchKey)), 'Invalid equipped layer color evidence.')
  if (v.kind === 'pack') {
    check(id(v.packReleaseId) && id(v.packPassId) && v.ownedBaseItemId === undefined
      && slot.sourceClass === 1 && slot.sourceDefinitionId === v.packReleaseId
      && slot.accessSubject === v.packPassId && slot.sourceEpoch === '0' && key(slot.sourceSemanticId),
    'Invalid equipped Pack source evidence.')
  } else {
    check((v.kind === 'base' || v.kind === 'owned-base') && v.packPassId === undefined && v.packReleaseId === undefined
      && slot.sourceClass === 0 && slot.sourceDefinitionId === v.rootId && slot.sourceSemanticId === '',
    'Invalid equipped Base source evidence.')
    check(v.kind === 'owned-base' ? id(v.ownedBaseItemId) && slot.accessSubject === v.ownedBaseItemId
      : v.ownedBaseItemId === undefined && slot.accessSubject === v.makerAccessId && slot.sourceEpoch === '0',
    'Invalid equipped Base entitlement evidence.')
  }
  assertNativeSealReadMetadata(v)
  check(v.policy.maxPlaintextBytes <= MAX_LAYER_BYTES
    && hash(v.ciphertext.ciphertextBlobCommitment) && hash(v.ciphertext.certificationCommitment),
  'Invalid equipped layer ciphertext policy or commitments.')
  approval(v)
  return v
}

function approval(v: NativeEquipmentReadTarget) {
  const common = { releaseCallablePackageId: v.release.callablePackageId, signer: v.owner,
    releaseConfigId: v.releaseConfigId, soulStateId: v.stateId, protocolConfigId: v.protocolConfigId,
    equipmentId: v.loadoutId, makerRootId: v.rootId, makerAccessPassId: v.makerAccessId,
    catalogId: v.catalogId, sealRegistryId: v.sealRegistryId, sealPolicyId: v.sealPolicyId,
    paymentCoinType: v.paymentCoinType, selectionIndex: String(v.selectionIndex),
    partKey: v.slot.partKey, itemKey: v.slot.itemKey, styleKey: v.slot.styleKey,
    ciphertextBlobCommitment: [...fromHex(v.ciphertext.ciphertextBlobCommitment)],
    certificationCommitment: [...fromHex(v.ciphertext.certificationCommitment)], sealId: v.ciphertext.sealId }
  return buildAnimacraftEquipmentReadApprovalV8(v.kind === 'pack'
    ? { ...common, kind: v.kind, packRegistryId: v.packRegistryId, packReleaseId: v.packReleaseId,
      packPassId: v.packPassId, assetContentCommitment: [...fromHex(v.slot.assetContentCommitment)],
      ciphertextBlobId: v.ciphertext.blobId, ciphertextSha256: [...fromHex(v.ciphertext.sha256)] }
    : v.kind === 'owned-base'
      ? { ...common, kind: v.kind, definitionRegistryId: v.runtimeDefinitionsId, baseRegistryId: v.baseRegistryId,
        packRegistryId: v.packRegistryId, ownedBaseItemId: v.ownedBaseItemId }
      : { ...common, kind: v.kind, definitionRegistryId: v.runtimeDefinitionsId, baseRegistryId: v.baseRegistryId })
}

/** Explicit wallet read of one current equipped selection, never original-recipe
 * authority. The caller must clear successful bytes after renderer decoding. */
export async function decryptNativeEquipmentLayer(params: NativeSealReadParams & {
  selectionIndex: number; expectedEquipment: ExpectedNativeEquipmentRead
  ciphertextBytes?: Uint8Array
}) {
  const { soulId, owner, selectionIndex } = params
  const expected = structuredClone(params.expectedEquipment)
  const result = await decryptNativeSealBytes(params, {
    validateTarget: value => assertNativeEquipmentReadTarget(value, soulId, owner, selectionIndex, expected),
    buildApproval: approval, minimumPlaintextBytes: 1, maximumPlaintextBytes: MAX_LAYER_BYTES,
    ciphertextBytes: params.ciphertextBytes,
  })
  try {
    params.signal.throwIfAborted()
    check(params.getAddress() === owner, 'The wallet changed. Reopen the equipped layer with the current wallet.')
    return result
  } catch (error) { result.bytes.fill(0); throw error }
}
