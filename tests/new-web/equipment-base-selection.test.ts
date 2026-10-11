import { expect, it } from 'vitest'
import { baseSelectionEligibility, equipmentEligibility, clearableEquipmentSelection, equipmentRemovalIndex } from '../../web/lib/animacraft/equipment-eligibility'
import { validateEquipmentOperationRecord, type EquipmentOperation } from '../../web/lib/animacraft/equipment-operation'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { equipmentOperationFixture, eid } from './fixtures/equipment-operation'
const selection = { baseRegistryId: eid(85), partKey: 'body', itemKey: 'hat', styleKey: 'red', swatchKey: 'red' }
async function empty() {
  const f = nativeEquipmentSourceFixture(); f.editLoadout(v => { v.selections = [null]; v.selection_count = '0' })
  const s = await f.readSource(); s.source!.definitions.item_assetization = false
  return s
}
it('uses included Base styles without inventory, Fixed/open restrictions or Complete Rules', async () => {
  const s = await empty(); s.source!.slots[0].wardrobe_mode = 0; s.source!.slots[0].behavior = 0; s.source!.slots[0].required = true
  expect(s.inventory).toBeNull(); expect(baseSelectionEligibility(s,{ selection })).toMatchObject({ allowed: true, slot: 0 })
  s.source!.currentProtocol = false
  expect(baseSelectionEligibility(s,{ selection }).allowed).toBe(true)
})
it.each(['listed','source','paused','access','equipment','assetized','base','item','status','style','protected','track','color','profile','full','revision'])
  ('rejects non-asset %s rather than coercing it into a wallet item', async problem => {
    const s = await empty(); const source = s.source!
    if (problem === 'listed') s.listed = true
    if (problem === 'source') s.source = null
    if (problem === 'paused') source.root.lifecycle = 2
    if (problem === 'access') source.access = null
    if (problem === 'equipment') s.equipment = null
    if (problem === 'assetized') source.definitions.item_assetization = true
    if (problem === 'base') source.base.id = eid(999)
    if (problem === 'item') source.items = []
    if (problem === 'status') source.items[0].status = 1
    if (problem === 'style') source.styles = []
    if (problem === 'protected') source.styles[0].protected = true
    if (problem === 'track') source.tracks = []
    if (problem === 'color') source.colors = []
    if (problem === 'profile') source.slots = []
    if (problem === 'full') s.equipment!.loadout.selections = [{} as any]
    if (problem === 'revision') s.equipment!.loadout.revision = '18446744073709551615'
    expect(baseSelectionEligibility(s,{ selection }).allowed).toBe(false)
  })
it('clears Base/Pack/protected entitlements without source, but cannot strand owned instance locks', async () => {
  const s = await nativeEquipmentSourceFixture().readSource(); s.source = null
  expect(clearableEquipmentSelection(s,0)).toBe(false)
  const row = s.equipment!.loadout.selections[0]!
  row.access_subject = s.equipment!.loadout.maker_access_pass_id
  expect(clearableEquipmentSelection(s,0)).toBe(true)
  row.protected = true; expect(clearableEquipmentSelection(s,0)).toBe(true)
  row.source_class = 1; expect(clearableEquipmentSelection(s,0)).toBe(true)
  expect(equipmentRemovalIndex(s,{ kind: 'selection', selectionIndex: '0' })).toBe(0)
  row.source_class = 2; expect(clearableEquipmentSelection(s,0)).toBe(false)
  for (const index of ['-1','00','500','9007199254740993']) expect(equipmentRemovalIndex(s,{ kind: 'selection', selectionIndex: index })).toBeNull()
})
it('replaces an owned component with included content and preserves actual first-free-slot behavior', async () => {
  const s = await nativeEquipmentSourceFixture().readSource(); s.source!.definitions.item_assetization = false
  expect(baseSelectionEligibility(s,{ selection, replaces: { kind: 'base', itemId: eid(84) } })).toMatchObject({ allowed: true, slot: 0 })
})
it('replaces an entitlement with an owned item, not an unverified bare index', async () => {
  const s = await nativeEquipmentSourceFixture().readBase()
  s.inventory!.objects[0].item.equip_lock = null; s.equipment!.instances = []
  s.equipment!.loadout.selections[0]!.access_subject = s.source!.access!.id
  const choice = { item: { kind: 'base' as const, itemId: eid(84), baseRegistryId: eid(85), styleKey: 'red', swatchKey: 'red' },
    replaces: { kind: 'selection' as const, selectionIndex: '0' } }
  expect(equipmentEligibility(s,choice)).toMatchObject({ allowed: true, slot: 0 })
  s.equipment!.loadout.selections[0]!.source_class = 2
  expect(equipmentEligibility(s,choice).allowed).toBe(false)
})
const operations: EquipmentOperation[] = [{ kind: 'clear-selection', selectionIndex: '0' }, { kind: 'select-base', selection },
  { kind: 'select-base', selection, replaces: { kind: 'selection', selectionIndex: '0' } },
  { kind: 'select-base', selection, replaces: { kind: 'base', itemId: eid(84) } },
  { kind: 'select-base', selection, replaces: { kind: 'external', itemId: eid(102) } },
  { kind: 'equip', item: { kind: 'external', itemId: eid(102), productId: eid(101) }, replaces: { kind: 'selection', selectionIndex: '0' } }]
it.each(operations)('validates exact native $kind $replaces.kind immutable recovery bytes', async operation => {
  const { record } = await equipmentOperationFixture(operation)
  expect(validateEquipmentOperationRecord(record)).toBe(record)
  record.revision = '2'; expect(() => validateEquipmentOperationRecord(record)).toThrow()
})
