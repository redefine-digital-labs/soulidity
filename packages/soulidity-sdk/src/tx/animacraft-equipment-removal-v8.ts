import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'
import { beginAnimacraftEquipmentV8Update, appendRemoveAnimacraftEquipmentV8,
  appendProveEquipmentPackDefinitionsV8, finishAnimacraftEquipmentV8Update,
  type AnimacraftEquipmentV8Scope, type AnimacraftEquipmentV8Removal } from './animacraft-equipment-v8'

export interface AnimacraftEquipmentV8RemovalPlan {
  scope: AnimacraftEquipmentV8Scope
  definitionRegistryId: string
  baseRegistryId: string
  removals: AnimacraftEquipmentV8Removal[]
  packs: Array<{ runtimeCallablePackageId: string; paymentCoinType: string; releaseId: string; bindingIndex: string }>
}

const MAX_U64 = (1n << 64n) - 1n
function objectId(value: unknown): void {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) {
    throw new Error('Equipment removal requires canonical nonzero object IDs')
  }
}
function u64(value: unknown): bigint {
  if ((typeof value !== 'string' && typeof value !== 'bigint') || !/^(0|[1-9][0-9]*)$/.test(String(value))) {
    throw new Error('Equipment removal requires an exact u64')
  }
  const result = BigInt(value)
  if (result > MAX_U64) throw new Error('Equipment removal revision overflow')
  return result
}

/** Remove only the certified explicit selections, retaining the Soul binding.
 * Pack proofs cover every attached Pack after the last removal. This does not
 * close, list or transfer any asset, nor certify the caller's chain readset.
 * Validate the whole plan before touching the caller-owned transaction. */
export function appendAnimacraftEquipmentV8RemovalPlan(tx: Transaction, input: AnimacraftEquipmentV8RemovalPlan): bigint {
  const plan = structuredClone(input)
  const { scope, removals, packs } = plan
  for (const id of [scope.soulStateId, scope.equipmentId, scope.target.soulidityCallablePackageId,
    scope.target.runtimeOriginalPackageId, scope.target.protocolConfigId, plan.definitionRegistryId, plan.baseRegistryId]) objectId(id)
  if (!Array.isArray(removals) || removals.length > 500 || !Array.isArray(packs) || packs.length > 500) {
    throw new Error('Invalid equipment removal or Pack count')
  }
  const revision = u64(scope.expectedRevision)
  const finalRevision = revision + BigInt(removals.length)
  if (finalRevision > MAX_U64) throw new Error('Equipment removal revision overflow')
  const instances = new Set<string>(), slots = new Set<string>(), releases = new Set<string>()
  for (const removal of removals) {
    const allowed = removal?.kind === 'selection' ? ['kind', 'selectionIndex'] : ['kind', 'itemId']
    if (!removal || typeof removal !== 'object' || Array.isArray(removal)
      || Object.keys(removal).some(key => !allowed.includes(key))) {
      throw new Error('Unexpected equipment removal fields')
    }
    if (removal?.kind === 'selection') {
      if (typeof removal.selectionIndex !== 'string' || u64(removal.selectionIndex) >= 500n) throw new Error('Invalid removal slot')
      if (slots.has(removal.selectionIndex)) throw new Error('Duplicate removal slot')
      slots.add(removal.selectionIndex)
    } else if (removal?.kind === 'base' || removal?.kind === 'external') {
      objectId(removal.itemId)
      if (instances.has(removal.itemId)) throw new Error('Duplicate equipped instance')
      instances.add(removal.itemId)
    } else throw new Error('Unsupported equipment removal kind')
  }
  for (const [index, pack] of packs.entries()) {
    if (!pack || pack.bindingIndex !== String(index)) throw new Error('Pack proof order must match the frozen equipment')
    objectId(pack.runtimeCallablePackageId); objectId(pack.releaseId)
    if (releases.has(pack.releaseId)) throw new Error('Duplicate equipment Pack release')
    releases.add(pack.releaseId)
    if (typeof pack.paymentCoinType !== 'string' || !pack.paymentCoinType.includes('::')) throw new Error('Pack paymentCoinType is required')
    normalizeStructTag(pack.paymentCoinType)
  }
  if (!removals.length) return revision
  const update = beginAnimacraftEquipmentV8Update(tx, scope)
  removals.forEach((previous, index) => appendRemoveAnimacraftEquipmentV8(tx,
    { ...scope, update, expectedRevision: revision + BigInt(index), previous }))
  const packDefinitionProofs = packs.map(pack => appendProveEquipmentPackDefinitionsV8(tx,
    { ...pack, equipmentId: scope.equipmentId, definitionRegistryId: plan.definitionRegistryId, baseRegistryId: plan.baseRegistryId }))
  finishAnimacraftEquipmentV8Update(tx, { ...scope, update,
    definitionRegistryId: plan.definitionRegistryId, baseRegistryId: plan.baseRegistryId, packDefinitionProofs })
  return finalRevision
}
