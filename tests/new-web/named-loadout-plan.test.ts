import { expect,it } from 'vitest'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { nativeEquipmentPackFixture } from './fixtures/native-equipment-pack'
import { nativeEquipmentSealFixture } from './fixtures/native-equipment-seal'
import { captureNamedLoadout } from '../../web/lib/animacraft/named-loadout'
import { planNamedLoadout } from '../../web/lib/animacraft/named-loadout-plan'

async function fixture() {
  const s = await nativeEquipmentSourceFixture().readBase()
  // Pure planner fixture: use the exact swatch required by the verified style.
  s.equipment!.loadout.selections[0]!.swatch_key = 'red'
  return s
}
it('validates an unchanged target without writes, including at u64 max',async () => {
  const s = await fixture(); s.equipment!.loadout.revision = '18446744073709551615'
  const before = JSON.stringify(s)
  expect(planNamedLoadout(s,captureNamedLoadout(s))).toEqual({removals:[],additions:[],unchangedSlots:[0],commandCount:0})
  expect(JSON.stringify(s)).toBe(before)
})
it('replaces the same Part appearance atomically without moving its component to another slot',async () => {
  const s = await fixture(); const saved = captureNamedLoadout(s)
  s.source!.colors[0].swatches.push({ ...s.source!.colors[0].swatches[0], key: 'blue' })
  saved.slots[0]!.swatchKey = 'blue'
  const before = JSON.stringify(s); const plan = planNamedLoadout(s,saved)
  expect(plan.removals).toEqual([{kind:'base',itemId:saved.slots[0]!.accessSubject}])
  expect(plan.additions[0]).toMatchObject({kind:'equip',targetSelectionIndex:'0',item:{swatchKey:'blue'}})
  expect(plan.commandCount).toBe(2); expect(JSON.stringify(s)).toBe(before)
})
it('applies the empty target by removal only',async () => {
  const s = await fixture(); const saved = captureNamedLoadout(s); saved.slots.fill(null)
  expect(planNamedLoadout(s,saved)).toMatchObject({additions:[],commandCount:1})
})
it('refuses to move a saved component into a different Part even when that Part is empty',async () => {
  const s=await fixture()
  s.equipment!.loadout.selections.push(null)
  s.source!.slots.push({...s.source!.slots[0],part_key:'badge',slotStart:1})
  const saved=captureNamedLoadout(s);saved.slots.reverse()
  expect(()=>planNamedLoadout(s,saved)).toThrow('same part')
})
it.each(['base-selection','pack-selection','external-item','protected-base'] as const)(
  'plans exact %s placement and validates unchanged source rights',async kind => {
    const f=nativeEquipmentSourceFixture()
    const s=kind==='pack-selection'?await nativeEquipmentPackFixture().readPack()
      :kind==='external-item'?await f.addExternal().read()
      :kind==='protected-base'?await nativeEquipmentSealFixture().readBase():await f.readBase()
    const current=s.equipment!.loadout.selections[0]!
    current.swatch_key='red'
    if(kind==='base-selection'){
      current.access_subject=s.equipment!.loadout.maker_access_pass_id
      s.equipment!.instances=[];s.source!.definitions.item_assetization=false
    }
    if(kind==='pack-selection'){
      const pack=s.source!.pack!.selected!, style=pack.styles[0]
      Object.assign(current,{source_class:1,source_definition_id:pack.release.id,access_subject:pack.pass.id,
        part_key:style.part_key,item_key:style.item_key,style_key:style.style_key,swatch_key:'snow',
        asset_content_commitment:style.asset_content_commitment,protected:style.protected,seal_binding_commitment:style.seal_binding_commitment})
      s.equipment!.instances=[]
    }
    if(kind==='external-item'){
      const entry=s.inventory!.objects[0],product=s.source!.external[0].product
      Object.assign(current,{source_class:2,source_definition_id:product.id,access_subject:entry.item.id,
        part_key:product.part_key,item_key:product.item_key,style_key:product.style_key,swatch_key:product.default_swatch_key,
        asset_content_commitment:product.asset_content_commitment})
      entry.item.equip_lock={loadout_id:s.equipment!.loadout.id,selection_index:'0',equip_revision:'1'}
      s.equipment!.instances=[{kind:'external',item:entry.item}]
    }
    if(kind==='protected-base'){
      current.protected=true;current.seal_binding_commitment=s.source!.protectedBase.entries[0].bindingCommitment!
    }
    const content=captureNamedLoadout(s)
    expect(planNamedLoadout(s,content).commandCount).toBe(0)
    const empty=structuredClone(s)
    empty.equipment!.loadout.selections=[null];empty.equipment!.loadout.selection_count='0';empty.equipment!.instances=[]
    for(const entry of empty.inventory?.objects??[])entry.item.equip_lock=null
    const plan=planNamedLoadout(empty,content)
    expect(plan.commandCount).toBe(1);expect(plan.additions[0].targetSelectionIndex).toBe('0')
    if(kind==='protected-base')expect(plan.additions[0]).toMatchObject({kind:'equip',item:{protection:s.source!.protectedBase.entries[0].proof}})
    // An identical saved target is never allowed to bypass current source checks.
    const unchanged=captureNamedLoadout(s)
    if(kind==='pack-selection')s.source!.pack!.selected!.admission!.admission_state=1
    else if(kind==='external-item')s.source!.external[0].product.lifecycle=1
    else if(kind==='protected-base')s.source!.protectedBase.available=false
    else s.source!.access=null
    expect(()=>planNamedLoadout(s,unchanged)).toThrow()
  })
it.each(['owner','epoch','root','equipment','capacity','content','style','swatch','rights','lock','listed','overflow'])(
  'rejects invalid %s, including unchanged references',async change => {
    const s = await fixture(); const saved = captureNamedLoadout(s)
    if (change === 'owner') saved.capturedOwner = `0x${'a'.repeat(64)}`
    if (change === 'epoch') saved.capturedOwnershipEpoch = '9'
    if (change === 'root') saved.rootContentCommitment = 'aa'.repeat(32)
    if (change === 'equipment') saved.capturedEquipmentId = `0x${'a'.repeat(64)}`
    if (change === 'capacity') saved.slots.push(null)
    if (change === 'content') s.source!.styles[0].payload_commitment = Array(32).fill(8)
    if (change === 'style') saved.slots[0]!.styleKey = 'missing'
    if (change === 'swatch') saved.slots[0]!.swatchKey = null
    if (change === 'rights') s.source!.ownership = []
    if (change === 'lock') s.inventory!.objects[0].item.equip_lock!.loadout_id = `0x${'a'.repeat(64)}`
    if (change === 'listed') s.listed = true
    if (change === 'overflow') {s.equipment!.loadout.revision='18446744073709551615';saved.slots.fill(null)}
    expect(() => planNamedLoadout(s,saved)).toThrow()
  })
