import { expect, it } from 'vitest'
import { equipmentEligibility, type EquipmentChoice } from '../../web/lib/animacraft/equipment-eligibility'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { EquipmentBaseItemBcs } from '../../web/lib/animacraft/native-equipment'
const id = (n: number) => `0x${n.toString(16).padStart(64,'0')}`
const choice: EquipmentChoice = { item: { kind: 'base', itemId: id(84), baseRegistryId: id(85), styleKey: 'red', swatchKey: 'red' } }
async function empty() {
  const f = nativeEquipmentSourceFixture()
  f.editLoadout(v => { v.selections = [null]; v.selection_count = '0' })
  f.set(id(84), EquipmentBaseItemBcs, v => { v.equip_lock = null })
  return f.readBase()
}
it('allows Base in a fixed part even with locked track, required part and complete-only Rules outstanding', async () => {
  const s = await empty(); const p = s.source!.slots[0]
  p.wardrobe_mode = 0; p.behavior = 0; p.required = true
  expect(s.source!.tracks[0].locked).toBe(true)
  expect(equipmentEligibility(s,choice)).toMatchObject({ allowed: true, slot: 0 })
})
it.each(['listed','source','paused','access','assetization','root','version','commitment','definitions','packs','base',
  'item-definition','item-status','payload','owner-record','owner-id','owner-epoch','style','protected','track','color','holder','locked','full','revision'])
  ('blocks Base %s with a user-facing reason', async problem => {
    const s = await empty(); const source = s.source!; const item = s.inventory!.objects[0].item as any
    if (problem === 'listed') s.listed = true
    if (problem === 'source') s.source = null
    if (problem === 'paused') source.root.lifecycle = 2
    if (problem === 'access') source.access = null
    if (problem === 'assetization') source.definitions.item_assetization = false
    if (problem === 'root') item.root_id = id(999)
    if (problem === 'version') item.root_version = '2'
    if (problem === 'commitment') item.root_content_commitment = Array(32).fill(99)
    if (problem === 'definitions') item.definition_registry_id = id(999)
    if (problem === 'packs') item.pack_registry_id = id(999)
    if (problem === 'base') item.base_registry_id = id(999)
    if (problem === 'item-definition') source.items = []
    if (problem === 'item-status') source.items[0].status = 1
    if (problem === 'payload') item.item_payload_commitment = Array(32).fill(99)
    if (problem === 'owner-record') source.ownership = []
    if (problem === 'owner-id') source.ownership[0].record!.item_id = id(999)
    if (problem === 'owner-epoch') source.ownership[0].record!.ownership_epoch = '99'
    if (problem === 'style') source.styles = []
    if (problem === 'protected') source.styles[0].protected = true
    if (problem === 'track') source.tracks = []
    if (problem === 'color') source.colors[0].swatches = []
    if (problem === 'holder') item.holder = id(999)
    if (problem === 'locked') item.equip_lock = { loadout_id: id(999), selection_index: '0', equip_revision: '0' }
    if (problem === 'full') s.equipment!.loadout.selections = [{} as any]
    if (problem === 'revision') s.equipment!.loadout.revision = '18446744073709551615'
    expect(equipmentEligibility(s,choice)).toMatchObject({ allowed: false, reason: expect.any(String) })
  })
it('requires an explicit swatch only when the selected style has a channel', async () => {
  const s = await empty(); const noColor: EquipmentChoice = { item: { ...choice.item as any, swatchKey: null } }
  expect(equipmentEligibility(s,noColor).allowed).toBe(false)
  s.source!.styles[0].color_channel_key = null
  expect(equipmentEligibility(s,noColor).allowed).toBe(true)
  expect(equipmentEligibility(s,choice).allowed).toBe(false)
})
it('replaces the same instance in its Part despite another Part being empty', async () => {
  const f = nativeEquipmentSourceFixture(); const s = await f.readBase()
  const replace = { ...choice, replaces: { kind: 'base' as const, itemId: id(84) } }
  expect(equipmentEligibility(s,choice).allowed).toBe(false)
  expect(equipmentEligibility(s,replace)).toMatchObject({ allowed: true, slot: 0 })
  const selection = s.equipment!.loadout.selections[0]!
  selection.selection_index = '1'; s.equipment!.loadout.selections = [null,selection]
  s.source!.slots[0].slotStart = 1
  s.equipment!.instances[0].item.equip_lock!.selection_index = '1'
  s.inventory!.objects[0].item.equip_lock!.selection_index = '1'
  expect(equipmentEligibility(s,replace)).toMatchObject({ allowed: true, slot: 1 })
  expect(equipmentEligibility(s,{ ...replace,targetSelectionIndex: '0' })).toMatchObject({ allowed: false })
  s.equipment!.loadout.revision = '18446744073709551614'
  expect(equipmentEligibility(s,replace).allowed).toBe(false)
})
it('checks current protocol only for create, not ordinary equip', async () => {
  const s = await empty(); s.source!.currentProtocol = false
  expect(equipmentEligibility(s,choice).allowed).toBe(true)
  s.equipment = null; s.status = 'NOT_CREATED'
  expect(equipmentEligibility(s).allowed).toBe(false)
  s.source!.currentProtocol = true
  expect(equipmentEligibility(s).allowed).toBe(true)
})
it.each(['valid','mode','behavior','lifecycle','admission','revoked','compatibility','product-content','asset','root','holder'])
  ('matches external %s rules without inventing attestation/ceiling checks', async problem => {
    const f = nativeEquipmentSourceFixture(); const e = f.addExternal()
    f.editLoadout(v => { v.selections = [null]; v.selection_count = '0' })
    const s = await e.read(); const source = s.source!; const entry = source.external[0]
    source.slots[0].admission_ceiling = 0; entry.admission!.attestation_commitment = null
    if (problem === 'mode') source.slots[0].wardrobe_mode = 0
    if (problem === 'behavior') source.slots[0].behavior = 1
    if (problem === 'lifecycle') entry.product.lifecycle = 1
    if (problem === 'admission') entry.admission = null
    if (problem === 'revoked') entry.admission!.admission_state = 1
    if (problem === 'compatibility') entry.admission!.compatibility_commitment = Array(32).fill(99)
    if (problem === 'product-content') entry.product.content_commitment = Array(32).fill(99)
    if (problem === 'asset') entry.product.asset_content_commitment = Array(32).fill(99)
    if (problem === 'root') entry.product.root_id = id(999)
    if (problem === 'holder') s.inventory!.objects[0].item.holder = id(999)
    expect(equipmentEligibility(s,{ item: { kind: 'external', itemId: e.itemId, productId: e.productId } }).allowed).toBe(problem === 'valid')
  })
