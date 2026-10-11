import { expect, it } from 'vitest'
import { selectedSoulEquipmentPlan } from '../../web/lib/animacraft/native-selected-soul-sale'
const id = (n: number) => '0x' + n.toString(16).padStart(64, '0')
function fixture() {
  const release = { soulidityCallablePackageId: id(1), runtimeOriginalPackageId: id(2), runtimeCallablePackageId: id(2),
    protocolConfigId: id(3), marketConfigV2Id: id(4), kioskRegistryId: id(5), soulTransferPolicyId: id(6), kioskPackageId: id(7) }
  const select = (index: number, source: number, subject: number) => ({ selection_index: String(index), source_class: source, access_subject: id(subject) })
  const equipment: any = { soulId: id(10), stateId: id(11), owner: id(12), ownershipEpoch: '7', listed: false,
    provenanceBindingId: id(13), release, updateSource: { definitionRegistryId: id(20), baseRegistryId: id(21),
      packDefinitions: [{ releaseId: id(22), paymentCoinType: '0x2::sui::SUI', definitionCommitment: 'ab'.repeat(32) }] },
    equipment: { loadout: { id: id(14), revision: '9007199254740993', maker_access_pass_id: id(30), selection_count: '4',
      selections: [select(0, 0, 31), null, select(2, 0, 30), select(3, 1, 32), select(4, 2, 33)],
      attached_pack_definitions: [{ release_id: id(22), definition_commitment: Array(32).fill(171) }] },
      instances: [{ kind: 'base', item: { id: id(31) } }, { kind: 'external', item: { id: id(33) } }] } }
  return { equipment }
}
it('derives every sparse slot, distinguishes usage rights from actual instances and preserves Pack order', () => {
  const f = fixture(), plan = selectedSoulEquipmentPlan(f.equipment)!
  expect(plan.removals).toEqual([{ kind: 'base', itemId: id(31) }, { kind: 'selection', selectionIndex: '2' },
    { kind: 'selection', selectionIndex: '3' }, { kind: 'external', itemId: id(33) }])
  expect(plan.scope.expectedRevision).toBe('9007199254740993')
  expect(plan.packs[0]).toMatchObject({ releaseId: id(22), bindingIndex: '0' })
  f.equipment.equipment.loadout.revision = '9'
  expect(plan.scope.expectedRevision).toBe('9007199254740993')
})
it.each(['missing instance', 'extra instance', 'wrong slot', 'wrong count', 'missing packs', 'pack commitment'])(
  'rejects incomplete authenticated mapping: %s', failure => {
    const f = fixture(), e = f.equipment
    if (failure === 'missing instance') e.equipment.instances.pop()
    if (failure === 'extra instance') e.equipment.instances.push({ kind: 'base', item: { id: id(99) } })
    if (failure === 'wrong slot') e.equipment.loadout.selections[0].selection_index = '1'
    if (failure === 'wrong count') e.equipment.loadout.selection_count = '3'
    if (failure === 'missing packs') e.updateSource.packDefinitions = []
    if (failure === 'pack commitment') e.updateSource.packDefinitions[0].definitionCommitment = '00'.repeat(32)
    expect(() => selectedSoulEquipmentPlan(e)).toThrow()
  })
