import type { SelectedAnimacraftSoulSaleV8 } from '@soulidity/sdk'
import type { readNativeEquipment } from './native-equipment'

const check = (value: unknown, message: string): void => { if (!value) throw new Error(message) }
type Equipment = Awaited<ReturnType<typeof readNativeEquipment>>

/** Complete removal plan from an already authenticated raw equipment read, not
 * checkbox state or wallet inventory. The sale never transfers these instances. */
export function selectedSoulEquipmentPlan(snapshot: Equipment): SelectedAnimacraftSoulSaleV8['equipment'] {
  if (!snapshot.equipment) return null
  const { loadout, instances } = snapshot.equipment, source = snapshot.updateSource
  if (!source) throw new Error('Verified equipment update source required')
  const instanceMap = new Map(instances.map(row => [row.item.id, row]))
  check(instanceMap.size === instances.length, 'Duplicate equipped instance proof')
  const seen = new Set<string>()
  const removals: NonNullable<SelectedAnimacraftSoulSaleV8['equipment']>['removals'] = []
  loadout.selections.forEach((selection, index) => {
    if (!selection) return
    check(selection.selection_index === String(index), 'Sparse equipment index mismatch')
    if (selection.source_class === 1 || (selection.source_class === 0 && selection.access_subject === loadout.maker_access_pass_id)) {
      removals.push({ kind: 'selection', selectionIndex: String(index) }); return
    }
    const instance = instanceMap.get(selection.access_subject)
    check(instance && !seen.has(selection.access_subject)
      && (selection.source_class === 0 ? instance.kind === 'base' : selection.source_class === 2 && instance.kind === 'external'),
    'Missing exact equipped instance proof')
    seen.add(selection.access_subject)
    removals.push({ kind: instance!.kind, itemId: selection.access_subject })
  })
  check(String(removals.length) === loadout.selection_count && seen.size === instances.length, 'Incomplete equipment removal plan')
  const packs = source.packDefinitions ?? []
  check(packs.length === loadout.attached_pack_definitions.length, 'Incomplete attached Pack proof sources')
  return { scope: { target: { soulidityCallablePackageId: snapshot.release.soulidityCallablePackageId,
    runtimeOriginalPackageId: snapshot.release.runtimeOriginalPackageId, protocolConfigId: snapshot.release.protocolConfigId },
    soulStateId: snapshot.stateId, equipmentId: loadout.id, expectedRevision: loadout.revision },
    definitionRegistryId: source.definitionRegistryId, baseRegistryId: source.baseRegistryId, removals,
    packs: packs.map((pack, index) => {
      const binding = loadout.attached_pack_definitions[index]
      check(binding.release_id === pack.releaseId && commitmentHex(binding.definition_commitment) === pack.definitionCommitment,
        'Attached Pack order/commitment changed')
      return { runtimeCallablePackageId: snapshot.release.runtimeCallablePackageId, paymentCoinType: pack.paymentCoinType,
        releaseId: pack.releaseId, bindingIndex: String(index) }
    }) }
}
const commitmentHex = (bytes: number[]) => bytes.map(byte => byte.toString(16).padStart(2, '0')).join('')
