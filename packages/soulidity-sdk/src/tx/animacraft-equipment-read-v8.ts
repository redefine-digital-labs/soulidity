import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'
import { parseWalrusAssetId } from '../walrus-asset-id'

/** Metadata is not authorization: Release independently verifies live native
 * Soul ownership, its exact equipment binding and the existing asset entitlement.
 * This does not authorize immutable original recipe layers or sign a transaction. */
interface EquipmentReadCommon {
  releaseCallablePackageId: string
  signer: string
  releaseConfigId: string
  soulStateId: string
  protocolConfigId: string
  equipmentId: string
  makerRootId: string
  makerAccessPassId: string
  catalogId: string
  sealRegistryId: string
  sealPolicyId: string
  paymentCoinType: string
  selectionIndex: string
  partKey: string
  itemKey: string
  styleKey: string
  ciphertextBlobCommitment: number[]
  certificationCommitment: number[]
  sealId: number[]
}
export type AnimacraftEquipmentReadApprovalV8 = EquipmentReadCommon & (
  | { kind: 'base'; definitionRegistryId: string; baseRegistryId: string }
  | { kind: 'owned-base'; definitionRegistryId: string; baseRegistryId: string;
      packRegistryId: string; ownedBaseItemId: string }
  | { kind: 'pack'; packRegistryId: string; packReleaseId: string; packPassId: string;
      assetContentCommitment: number[]; ciphertextBlobId: string; ciphertextSha256: number[] }
)

export function buildAnimacraftEquipmentReadApprovalV8(input: AnimacraftEquipmentReadApprovalV8): Transaction {
  const p = structuredClone(input)
  if (!['base', 'owned-base', 'pack'].includes(p.kind)) throw new Error('Unsupported equipped source')
  const id = (value: string, label: string) => {
    if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) {
      throw new Error(`${label} must be a canonical nonzero ID`)
    }
    return value
  }
  const hash = (value: number[], label: string) => {
    if (!Array.isArray(value) || value.length !== 32
      || value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      throw new Error(`${label} must contain exactly 32 bytes`)
    }
    return value
  }
  id(p.releaseCallablePackageId, 'releaseCallablePackageId'); id(p.signer, 'signer')
  if (typeof p.paymentCoinType !== 'string' || !p.paymentCoinType.includes('::')) {
    throw new Error('paymentCoinType must be an explicit Move struct type')
  }
  normalizeStructTag(p.paymentCoinType)
  if (typeof p.selectionIndex !== 'string' || !/^(0|[1-9][0-9]*)$/.test(p.selectionIndex)
    || BigInt(p.selectionIndex) >= 500n) throw new Error('selectionIndex must be an exact occupied slot index below 500')
  for (const key of ['partKey', 'itemKey', 'styleKey'] as const) {
    if (typeof p[key] !== 'string' || new TextEncoder().encode(p[key]).length < 1
      || new TextEncoder().encode(p[key]).length > 128 || /[\0/]/.test(p[key])) {
      throw new Error(`${key} must be an exact 1–128 byte semantic key`)
    }
  }
  const tx = new Transaction()
  tx.setSender(p.signer)
  const obj = (value: string, label: string) => tx.object(id(value, label))
  const bytes = (value: number[], label: string) => tx.pure.vector('u8', hash(value, label))
  const args = [bytes(p.sealId, 'sealId'), obj(p.releaseConfigId, 'releaseConfigId'),
    obj(p.soulStateId, 'soulStateId'), obj(p.protocolConfigId, 'protocolConfigId'), obj(p.equipmentId, 'equipmentId')]
  if (p.kind === 'pack') {
    args.push(obj(p.packRegistryId, 'packRegistryId'), obj(p.packReleaseId, 'packReleaseId'),
      obj(p.packPassId, 'packPassId'), obj(p.catalogId, 'catalogId'), obj(p.makerRootId, 'makerRootId'),
      obj(p.makerAccessPassId, 'makerAccessPassId'))
  } else {
    if (p.kind === 'owned-base') args.push(obj(p.ownedBaseItemId, 'ownedBaseItemId'))
    args.push(obj(p.definitionRegistryId, 'definitionRegistryId'))
    if (p.kind === 'owned-base') args.push(obj(p.packRegistryId, 'packRegistryId'))
    args.push(obj(p.baseRegistryId, 'baseRegistryId'), obj(p.makerRootId, 'makerRootId'),
      obj(p.makerAccessPassId, 'makerAccessPassId'), obj(p.catalogId, 'catalogId'))
  }
  args.push(obj(p.sealRegistryId, 'sealRegistryId'), obj(p.sealPolicyId, 'sealPolicyId'),
    tx.pure.u64(p.selectionIndex), tx.pure.string(p.partKey), tx.pure.string(p.itemKey), tx.pure.string(p.styleKey))
  if (p.kind === 'pack') {
    if (!parseWalrusAssetId(p.ciphertextBlobId)) {
      throw new Error('ciphertextBlobId must be one canonical Walrus blob or Quilt patch ID')
    }
    args.push(bytes(p.assetContentCommitment, 'assetContentCommitment'), tx.pure.string(p.ciphertextBlobId),
      bytes(p.ciphertextSha256, 'ciphertextSha256'))
  }
  args.push(bytes(p.ciphertextBlobCommitment, 'ciphertextBlobCommitment'),
    bytes(p.certificationCommitment, 'certificationCommitment'), bytes(p.sealId, 'sealId'))
  tx.moveCall({ target: `${p.releaseCallablePackageId}::release_v8::seal_approve_equipped_${p.kind.replace('-', '_')}_v8`,
    typeArguments: [p.paymentCoinType], arguments: args })
  return tx
}
