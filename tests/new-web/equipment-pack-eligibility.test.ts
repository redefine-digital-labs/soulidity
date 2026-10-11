import { expect,it } from 'vitest'
import { packSelectionEligibility } from '../../web/lib/animacraft/equipment-eligibility'
import { nativeEquipmentPackFixture,packId as id } from './fixtures/native-equipment-pack'
const selection = { baseRegistryId: id(85),releaseId: id(202),passId: id(201),partKey: 'body',itemKey: 'pack-hat',styleKey: 'snow',swatchKey: 'snow' }
async function empty() {
  const f = nativeEquipmentPackFixture(); f.editLoadout(v => { v.selections = [null];v.selection_count = '0' })
  return f.readPack()
}
it('uses Pack-only item/style/color definitions and an existing pass without repeating a purchase or completion', async () => {
  const s = await empty(); const source = s.source!; const pack = source.pack!.selected!
  expect(s.inventory).toBeNull(); expect(source.styles.some(row => row.item_key === selection.itemKey)).toBe(false)
  expect(source.colors.some(row => row.key === 'pack-tint')).toBe(false)
  source.currentProtocol = false; source.definitions.item_assetization = false; source.slots[0].behavior = 1
  pack.release.owner = id(999);pack.release.control_epoch = '100';pack.release.access_kind = 2;pack.release.access_price_atomic = '999'
  pack.release.complete_mode = 3;pack.release.complete_total_cap = '1';pack.release.total_complete_count = '1'
  expect(packSelectionEligibility(s,{selection})).toMatchObject({allowed:true,slot:0})
  pack.styles[0].protected = true;pack.styles[0].seal_binding_commitment = Array(32).fill(1)
  expect(packSelectionEligibility(s,{selection}).allowed).toBe(true)
})
it.each(['listed','source','root','maker-access','equipment','pack','pass','holder','release','base','root-version','pass-root',
  'content','lifecycle','admission','revoked','semantic','semantic-id','admission-content','profile','fixed','behavior','style','color','full','revision'])
  ('rejects Pack %s with an actionable reason', async problem => {
    const s = await empty(); const source = s.source!; const pack = source.pack!.selected!
    if (problem === 'listed') s.listed = true
    if (problem === 'source') s.source = null
    if (problem === 'root') source.root.lifecycle = 2
    if (problem === 'maker-access') source.access = null
    if (problem === 'equipment') s.equipment = null
    if (problem === 'pack') source.pack = null
    if (problem === 'pass') pack.pass.id = id(999)
    if (problem === 'holder') pack.pass.holder = id(999)
    if (problem === 'release') pack.release.id = id(999)
    if (problem === 'base') source.base.id = id(999)
    if (problem === 'root-version') pack.release.root_version = '2'
    if (problem === 'pass-root') pack.pass.root_id = id(999)
    if (problem === 'content') pack.pass.release_content_commitment = Array(32).fill(99)
    if (problem === 'lifecycle') pack.release.lifecycle = 1
    if (problem === 'admission') pack.admission = null
    if (problem === 'revoked') pack.admission!.admission_state = 1
    if (problem === 'semantic') pack.semanticReleaseId = id(999)
    if (problem === 'semantic-id') pack.admission!.semantic_pack_id = 'other'
    if (problem === 'admission-content') pack.admission!.release_content_commitment = Array(32).fill(99)
    if (problem === 'profile') source.slots = []
    if (problem === 'fixed') source.slots[0].wardrobe_mode = 0
    if (problem === 'behavior') source.slots[0].behavior = 0
    if (problem === 'style') pack.styles = []
    if (problem === 'color') pack.colors = []
    if (problem === 'full') s.equipment!.loadout.selections = [{} as any]
    if (problem === 'revision') s.equipment!.loadout.revision = '18446744073709551615'
    expect(packSelectionEligibility(s,{selection}),problem).toMatchObject({allowed:false,reason:expect.any(String)})
  })
it('requires an explicit swatch, not the Pack default, and permits null only without a channel', async () => {
  const s = await empty()
  expect(packSelectionEligibility(s,{selection:{...selection,swatchKey:null}}).allowed).toBe(false)
  expect(packSelectionEligibility(s,{selection:{...selection,swatchKey:'gold'}}).allowed).toBe(true)
  s.source!.pack!.selected!.styles[0].color_channel_key = null
  expect(packSelectionEligibility(s,{selection}).allowed).toBe(false)
  expect(packSelectionEligibility(s,{selection:{...selection,swatchKey:null}}).allowed).toBe(true)
})
it('replaces the actual same-part owned component or entitlement and predicts first free slot', async () => {
  const s = await nativeEquipmentPackFixture().readPack()
  expect(packSelectionEligibility(s,{selection,replaces:{kind:'base',itemId:id(84)}})).toMatchObject({allowed:true,slot:0})
  s.equipment!.instances = [];s.equipment!.loadout.selections[0]!.source_class = 1
  expect(packSelectionEligibility(s,{selection,replaces:{kind:'selection',selectionIndex:'0'}}).allowed).toBe(true)
  s.equipment!.loadout.selections[0]!.part_key = 'other'
  expect(packSelectionEligibility(s,{selection,replaces:{kind:'selection',selectionIndex:'0'}}).allowed).toBe(false)
})
