import { expect,it,vi } from 'vitest'
import { Inputs,Transaction,TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64,toBase64 } from '@mysten/sui/utils'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { equipmentOperationFixture,eid,signer,release } from './fixtures/equipment-operation'
import { captureNamedLoadout } from '../../web/lib/animacraft/named-loadout'
import { planNamedLoadout } from '../../web/lib/animacraft/named-loadout-plan'
import { createEquipmentOperationAdapter } from '../../web/lib/animacraft/equipment-operation-adapter'
import { validateEquipmentOperationRecord,runEquipmentOperation,type EquipmentOperation } from '../../web/lib/animacraft/equipment-operation'

async function fixture() {
  const snapshot = await nativeEquipmentSourceFixture().readBase()
  snapshot.owner=signer.toSuiAddress();snapshot.release=structuredClone(release)
  snapshot.source!.access!.holder=snapshot.owner
  snapshot.inventory!.objects.forEach(row=>{row.item.holder=snapshot.owner})
  snapshot.equipment!.loadout.selections[0]!.swatch_key='red'
  snapshot.source!.colors[0].swatches.push({...snapshot.source!.colors[0].swatches[0],key:'blue'})
  const previousContent=captureNamedLoadout(snapshot),content=structuredClone(previousContent)
  content.slots[0]!.swatchKey='blue'
  const operation: EquipmentOperation={kind:'apply-loadout',content,previousContent,plan:planNamedLoadout(snapshot,content)}
  const {record,tx}=await equipmentOperationFixture(operation)
  const attributes={max_programmable_tx_commands:'1024',max_input_objects:'2048',max_tx_size_bytes:'131072',max_pure_argument_size:'16384'}
  const client={ledgerService:{
    getServiceInfo:vi.fn(async()=>({response:{chainId:'4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S'}})),
    getEpoch:vi.fn(async()=>({response:{epoch:{epoch:9n}}})),
    getTransaction:vi.fn(async()=>{throw {code:'NOT_FOUND'}}),
  },core:{
    getProtocolConfig:vi.fn(async()=>({protocolConfig:{attributes}})),
    simulateTransaction:vi.fn(async()=>({$kind:'Transaction'})),
    executeTransaction:vi.fn(),
    resolveTransactionPlugin:()=>async(data:any,_options:any,next:()=>Promise<void>)=>{
      data.inputs=data.inputs.map((input:any)=>{
        if(!input.UnresolvedObject)return input
        const objectId=input.UnresolvedObject.objectId
        return [eid(84),eid(83)].includes(objectId)?Inputs.ObjectRef({objectId,version:'2',digest:release.soulidityCallableDigest})
          :Inputs.SharedObjectRef({objectId,initialSharedVersion:'1',mutable:objectId===eid(80)})
      })
      data.gasData=tx.getData().gasData;await next()
    },
  }}
  const sign=vi.fn(),read=vi.fn(async()=>snapshot)
  const adapter=createEquipmentOperationAdapter({client:client as any,read,observed:structuredClone(snapshot),getAddress:()=>snapshot.owner,sign})
  return {snapshot,operation,record,adapter,client,attributes,sign,read}
}
it('builds one exact removal-before-placement PTB with successive revisions, ignoring supplied plans',async()=>{
  const f=await fixture()
  const result=await f.adapter.prepare({...f.operation,plan:undefined,previousContent:undefined})
  expect(result.bytes).toBe(f.record.bytes)
  expect(Transaction.from(fromBase64(result.bytes)).getData().commands.flatMap(row=>row.MoveCall?[row.MoveCall.function]:[]))
    .toEqual(['begin_update_v8','unequip_base_v8','equip_base_v8','finish_update_v8'])
  expect(result.operation).toEqual(f.operation)
  await f.adapter.preflight(result,true)
  expect(f.client.core.simulateTransaction).toHaveBeenCalledTimes(2)
  expect(f.sign).not.toHaveBeenCalled()
})
it('changes two distinct Parts in one guard spanning four mutations',async()=>{
  const f=await fixture(),s=f.snapshot
  const second=structuredClone(s.inventory!.objects[0]);second.item.id=eid(86);second.item.equip_lock!.selection_index='1'
  if(!('part_key' in second.item))throw Error('Expected Base component')
  second.item.part_key='badge'
  s.source!.slots.push({...s.source!.slots[0],part_key:'badge',slotStart:1})
  s.source!.items.push({...s.source!.items[0],part_key:'badge'})
  s.source!.styles.push({...s.source!.styles[0],part_key:'badge'})
  s.inventory!.objects.push(second);s.equipment!.instances.push(structuredClone(second))
  const ownership=structuredClone(s.source!.ownership[0]);ownership.itemId=eid(86);ownership.record!.item_id=eid(86)
  s.source!.ownership.push(ownership)
  s.equipment!.loadout.selections[1]={...s.equipment!.loadout.selections[0]!,part_key:'badge',selection_index:'1',access_subject:eid(86)}
  s.equipment!.loadout.selection_count='2'
  const previousContent=captureNamedLoadout(s),content=structuredClone(previousContent)
  content.slots.forEach(row=>{if(row)row.swatchKey='blue'})
  const plan=planNamedLoadout(s,content)
  const {record}=await equipmentOperationFixture({kind:'apply-loadout',content,previousContent,plan})
  expect(validateEquipmentOperationRecord(record)).toBe(record)
  expect(plan.commandCount).toBe(4)
  const data=Transaction.from(fromBase64(record.bytes)).getData()
  expect(data.commands.flatMap(row=>row.MoveCall?[row.MoveCall.function]:[]))
    .toEqual(['begin_update_v8','unequip_base_v8','unequip_base_v8','equip_base_v8','equip_base_v8','finish_update_v8'])
  expect(plan.additions.map(row=>row.targetSelectionIndex)).toEqual(['0','1'])
})
it('reports no-change without building, signing or writing WAL',async()=>{
  const f=await fixture(),write=vi.fn()
  await expect(runEquipmentOperation({soulId:f.record.soulId,owner:f.record.owner,
    operation:{kind:'apply-loadout',content:captureNamedLoadout(f.snapshot)},adapter:f.adapter,
    store:{read:()=>null,write,exclusive:async(_key,work)=>work()}})).rejects.toMatchObject({code:'NO_CHANGE'})
  expect(write).not.toHaveBeenCalled();expect(f.sign).not.toHaveBeenCalled();expect(f.client.core.getProtocolConfig).not.toHaveBeenCalled()
})
it.each(['plan','target','content','previous','scope','source','revision','bytes','classification'])(
  'rejects persisted loadout %s tampering',async change=>{
    const f=await fixture(),record=structuredClone(f.record),op=record.operation
    if(op.kind!=='apply-loadout')throw Error('fixture')
    if(change==='plan')op.plan!.removals.push({kind:'base',itemId:eid(999)})
    if(change==='target')op.plan!.additions[0].targetSelectionIndex='1'
    if(change==='content')op.content.slots[0]!.styleKey='unrelated'
    if(change==='previous')op.previousContent!.slots[0]=null
    if(change==='scope')op.content.stateId=eid(999)
    if(change==='source')record.source!.makerRootId=eid(999)
    if(change==='revision')record.revision='18446744073709551615'
    if(change==='bytes'||change==='classification'){
      const data=Transaction.from(fromBase64(record.bytes)).getData()
      if(change==='bytes')data.commands.reverse()
      else {const index=data.inputs.findIndex(row=>row.Object?.ImmOrOwnedObject?.objectId===eid(84));data.inputs[index]=Inputs.SharedObjectRef({objectId:eid(84),initialSharedVersion:'1',mutable:false})}
      const bytes=await Transaction.from(JSON.stringify(data)).build();record.bytes=toBase64(bytes);record.digest=TransactionDataBuilder.getDigestFromBytes(bytes)
    }
    expect(()=>validateEquipmentOperationRecord(record)).toThrow()
  })
it.each(['commands','objects','bytes','missing-limit','simulation','overflow'])('blocks %s before signing',async change=>{
  const f=await fixture()
  if(change==='commands')f.attributes.max_programmable_tx_commands='1'
  if(change==='objects')f.attributes.max_input_objects='1'
  if(change==='bytes')f.attributes.max_tx_size_bytes='1'
  if(change==='missing-limit')delete (f.attributes as any).max_pure_argument_size
  if(change==='simulation')f.client.core.simulateTransaction.mockResolvedValue({$kind:'FailedTransaction'})
  if(change==='overflow')f.snapshot.equipment!.loadout.revision='18446744073709551615'
  await expect(f.adapter.prepare(f.operation)).rejects.toThrow();expect(f.sign).not.toHaveBeenCalled()
})
it('fresh preflight checks the entire frozen plan and signed recovery does not resolve content',async()=>{
  const f=await fixture(),record=await f.adapter.prepare(f.operation)
  f.snapshot.source!.styles[0].payload_commitment=Array(32).fill(77)
  await expect(f.adapter.preflight(record,true)).rejects.toThrow('content')
  f.snapshot.source=null
  await f.adapter.preflight(record,false);expect(f.read).toHaveBeenLastCalledWith(undefined)
  expect(await f.adapter.query(record)).toBe('MISSING')
})
it('pending recovery never builds a new transaction or looks up the preset',async()=>{
  const f=await fixture(),signed={...f.record,phase:'SIGNED' as const,signature:(await signer.signTransaction(fromBase64(f.record.bytes))).signature}
  const adapter={...f.adapter,prepare:vi.fn(f.adapter.prepare),query:vi.fn(async()=> 'PENDING' as const)}
  const result=await runEquipmentOperation({soulId:signed.soulId,owner:signed.owner,adapter,
    store:{read:()=>signed,write:vi.fn(),exclusive:async(_key,work)=>work()}})
  expect(result.bytes).toBe(signed.bytes);expect(adapter.prepare).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();expect(f.sign).not.toHaveBeenCalled()
})
