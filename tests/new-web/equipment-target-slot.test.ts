import { expect,it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction,TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { validateEquipmentOperationRecord,type EquipmentOperation } from '../../web/lib/animacraft/equipment-operation'
import { equipmentEligibility,baseSelectionEligibility,packSelectionEligibility } from '../../web/lib/animacraft/equipment-eligibility'
import { equipmentOperationFixture,eid } from './fixtures/equipment-operation'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { nativeEquipmentPackFixture } from './fixtures/native-equipment-pack'

const item = { kind:'base' as const,itemId:eid(84),baseRegistryId:eid(85),styleKey:'red',swatchKey:'red' }
const selection = { baseRegistryId:eid(85),partKey:'body',itemKey:'hat',styleKey:'red',swatchKey:'red' }
const protection = { sealRegistryId:eid(401),sealPolicyId:eid(402),ciphertextBlobCommitment:Array(32).fill(1),
  certificationCommitment:Array(32).fill(2),sealId:Array(32).fill(3) }
const operations: EquipmentOperation[] = [
  {kind:'equip',item}, {kind:'equip',item:{...item,protection}},
  {kind:'equip',item:{kind:'external',itemId:eid(102),productId:eid(101)}},
  {kind:'select-base',selection}, {kind:'select-base',selection:{...selection,protection}},
  {kind:'select-pack',selection:{...selection,releaseId:eid(202),passId:eid(201)}},
]
it.each([{kind:'create'},{kind:'close'},{kind:'clear-selection',selectionIndex:'0'},
  {kind:'unequip-base',itemId:eid(84)},{kind:'unequip-external',itemId:eid(102)}] as EquipmentOperation[])
  ('rejects irrelevant target-slot metadata on $kind recovery', async operation => {
    const {record} = await equipmentOperationFixture(operation)
    expect(() => validateEquipmentOperationRecord({...record,operation:{...operation,targetSelectionIndex:'0'}})).toThrow(/only valid/)
  })
it.each(operations)('binds $kind exact slot to actual resolved PTB bytes and rejects slot tampering', async operation => {
  const targeted = {...operation,targetSelectionIndex:'499'} as EquipmentOperation
  const {record,tx} = await equipmentOperationFixture(targeted)
  expect(validateEquipmentOperationRecord(record)).toBe(record)
  const data = tx.getData(); const call = data.commands.at(-3)!.MoveCall!
  expect(data.commands[0].MoveCall!.function).toBe('begin_update_v8')
  expect(data.commands.at(-1)!.MoveCall!.function).toBe('finish_update_v8')
  const offset = operation.kind === 'equip' ? 9 : operation.kind === 'select-pack' ? 10 : 8
  const slot = data.inputs[call.arguments[offset].Input!].Pure!
  expect(bcs.option(bcs.u64()).fromBase64(slot.bytes)).toBe('499')
  expect(() => validateEquipmentOperationRecord({...record,operation:{...targeted,targetSelectionIndex:'498'}})).toThrow(/mismatch/)
  slot.bytes = toBase64(bcs.option(bcs.u64()).serialize('498').toBytes())
  const bytes = await Transaction.from(JSON.stringify(data)).build()
  expect(() => validateEquipmentOperationRecord({...record,bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes)})).toThrow(/mismatch/)
  for (const bad of ['500','-1','01','1.0','',null,1]) {
    await expect(equipmentOperationFixture({...operation,targetSelectionIndex:bad} as EquipmentOperation)).rejects.toThrow()
  }
})
it.each(['owned','base','pack'] as const)('preserves sparse %s Part replacement without allowing another position in that Part', async kind => {
  const s = kind === 'pack' ? await nativeEquipmentPackFixture().readPack() : await nativeEquipmentSourceFixture().readBase()
  s.source!.slots[0].slotStart = 1
  const row = s.equipment!.loadout.selections[0]!
  row.selection_index = '1'
  s.equipment!.loadout.selections = [null,row,null]
  const replaces = kind === 'owned' ? {kind:'base' as const,itemId:item.itemId} : {kind:'selection' as const,selectionIndex:'1'}
  if (kind === 'owned') {
    s.equipment!.instances[0].item.equip_lock!.selection_index = '1'
    s.inventory!.objects[0].item.equip_lock!.selection_index = '1'
  } else {
    row.source_class = kind === 'pack' ? 1 : 0
    row.access_subject = s.equipment!.loadout.maker_access_pass_id
    s.source!.definitions.item_assetization = false
  }
  const check = (targetSelectionIndex?: string) => kind === 'owned'
    ? equipmentEligibility(s,{item,replaces,targetSelectionIndex})
    : kind === 'base' ? baseSelectionEligibility(s,{selection,replaces,targetSelectionIndex})
    : packSelectionEligibility(s,{selection:{...selection,itemKey:'pack-hat',styleKey:'snow',swatchKey:'snow',releaseId:eid(202),passId:eid(201)},replaces,targetSelectionIndex})
  expect(check()).toMatchObject({allowed:true,slot:1})
  for (const bad of ['0','2','3','499','500','-1','01','']) expect(check(bad)).toMatchObject({allowed:false})
  expect(check('1')).toMatchObject({allowed:true,slot:1})
  s.source!.slots[0].capacity = '2'
  expect(check('1')).toMatchObject({allowed:false,reason:expect.stringContaining('single-item')})
})
