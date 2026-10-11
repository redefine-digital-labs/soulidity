import {expect,it} from 'vitest'
import {Inputs,Transaction} from '@mysten/sui/transactions'
import {equipmentMarketOperationFixture,equipmentRecordWithTransaction,emid} from './fixtures/equipment-market-operation'
import {validateEquipmentMarketOperationRecord,validateEquipmentMarketSnapshot} from '../../web/lib/animacraft/equipment-market-operation'

it.each(['list','buy','reprice','cancel','recover'] as const)('validates %s exact production SDK bytes for Base/External',async action=>{
  for(const kind of ['base','external'] as const){
    const f=await equipmentMarketOperationFixture({action,kind})
    expect(validateEquipmentMarketOperationRecord(f.record)).toEqual(f.record)
  }
})
it('lists an explicitly selected equipped Base with partial removal and no binding close',async()=>{
  const f=await equipmentMarketOperationFixture({equipped:true})
  const calls=f.tx.getData().commands.flatMap(c=>c.MoveCall?[c.MoveCall.function]:[])
  expect(f.snapshot.removal?.sellSoul).toBe(false)
  expect(f.snapshot.removal?.equipment?.plan.removals).toEqual([{kind:'base',itemId:f.itemId}])
  expect(calls).toContain('list_base_equipment_v8')
  expect(calls.some(name=>/close.*equipment|list.*soul/.test(name))).toBe(false)
  expect(f.snapshot.removal!.equipment!.retainedSelectionIndexes).toEqual(['1'])
  expect(f.tx.getData().inputs.some(i=>i.Object?.ImmOrOwnedObject?.objectId===emid(102))).toBe(false)
})
it('lists an equipped External while retaining the unchecked Base instance',async()=>{
  const f=await equipmentMarketOperationFixture({equipped:true,kind:'external'})
  expect(f.snapshot.removal!.equipment!.plan.removals).toEqual([{kind:'external',itemId:emid(102)}])
  expect(f.snapshot.removal!.equipment!.retainedSelectionIndexes).toEqual(['0'])
  expect(f.tx.getData().inputs.some(i=>i.Object?.ImmOrOwnedObject?.objectId===emid(84))).toBe(false)
})
it('accepts the actual readonly SoulState ABI for partial removal without closing the binding',async()=>{
  const f=await equipmentMarketOperationFixture({equipped:true}),data=f.tx.getData()
  const stateId=f.snapshot.removal!.stateId
  const index=data.inputs.findIndex(i=>i.Object?.SharedObject?.objectId===stateId)
  expect(index).toBeGreaterThanOrEqual(0)
  data.inputs[index]=Inputs.SharedObjectRef({objectId:stateId,initialSharedVersion:'1',mutable:false})
  const r=await equipmentRecordWithTransaction(f.record,Transaction.from(JSON.stringify(data)))
  expect(validateEquipmentMarketOperationRecord(r)).toEqual(r)
  data.inputs[index]=Inputs.SharedObjectRef({objectId:stateId,initialSharedVersion:'1',mutable:true})
  const writable=await equipmentRecordWithTransaction(f.record,Transaction.from(JSON.stringify(data)))
  expect(()=>validateEquipmentMarketOperationRecord(writable)).toThrow('shared input mismatch')
})
it.each(['owned version','owned digest','gas asset','gas payment','Receiving owned','Receiving version','command','extra transfer'] as const)(
  'rejects %s despite recomputing a valid transaction digest',async change=>{
    const action=change.startsWith('owned')?'list':'buy',f=await equipmentMarketOperationFixture({action})
    const data=f.tx.getData(),index=data.inputs.findIndex(i=>i.Object?.ImmOrOwnedObject?.objectId===f.itemId||i.Object?.Receiving?.objectId===f.itemId)
    if(change==='owned version')data.inputs[index]=Inputs.ObjectRef({...f.snapshot.reference,version:'3'})
    if(change==='owned digest')data.inputs[index]=Inputs.ObjectRef({...f.snapshot.reference,digest:'1'.repeat(32)})
    if(change==='gas asset')data.gasData.payment=[f.snapshot.reference]
    if(change==='gas payment')data.gasData.payment=[f.record.paymentCoins[0]]
    if(change==='Receiving owned')data.inputs[index]=Inputs.ObjectRef(f.snapshot.reference)
    if(change==='Receiving version')data.inputs[index]=Inputs.ReceivingRef({...f.snapshot.reference,version:'3'})
    if(change==='command')data.commands.at(-1)!.MoveCall!.function='purchase_external_equipment_v8'
    const tx=Transaction.from(JSON.stringify(data))
    if(change==='extra transfer')tx.transferObjects([tx.gas],tx.pure.address(emid(999)))
    const changed=await equipmentRecordWithTransaction(f.record,tx)
    expect(()=>validateEquipmentMarketOperationRecord(changed)).toThrow()
  })
it.each(['price','quote','epoch','pin','alias','payment','disabled'] as const)('validates frozen metadata boundary: %s',async change=>{
  const f=await equipmentMarketOperationFixture({action:'buy'}),r=structuredClone(f.record)
  if(change==='price')r.priceAtomic='10002'
  if(change==='quote')r.snapshot.listing!.quoteCommitment='01'.repeat(32)
  if(change==='epoch')r.snapshot.ownershipEpoch='01'
  if(change==='pin')r.snapshot.release.equipmentMarket!.callablePackageId=emid(999)
  if(change==='alias')r.snapshot.target.treasuryId=r.snapshot.asset.itemId
  if(change==='payment')r.paymentCoins[0].balanceAtomic='1'
  if(change==='disabled'){
    r.snapshot.release.marketWritesEnabled=false;r.snapshot.release.equipmentWritesEnabled=false
    expect(validateEquipmentMarketOperationRecord(r)).toEqual(r);return
  }
  expect(()=>validateEquipmentMarketOperationRecord(r)).toThrow()
})
it('does not accept a locked instance for listing without a certified removal',async()=>{
  const f=await equipmentMarketOperationFixture({equipped:true}),s=structuredClone(f.snapshot)
  s.removal=null
  expect(()=>validateEquipmentMarketSnapshot(s)).toThrow('Locked equipment requires')
  s.available.list=false
  expect(validateEquipmentMarketSnapshot(s).available.list).toBe(false)
  expect(()=>validateEquipmentMarketOperationRecord({...f.record,snapshot:s})).toThrow()
})
