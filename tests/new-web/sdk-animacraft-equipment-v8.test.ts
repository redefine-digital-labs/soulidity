import { describe, expect, it } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { buildCreateAnimacraftEquipmentV8Tx, buildCloseEmptyAnimacraftEquipmentV8Tx,
  buildReplaceAnimacraftItemV8Tx, appendEquipAnimacraftItemV8, appendUnequipAnimacraftItemV8,
  appendClearAnimacraftSelectionV8, appendSelectAnimacraftBaseStyleV8, appendSelectAnimacraftPackStyleV8, appendAttachAnimacraftPackDefinitionsV8,
  beginAnimacraftEquipmentV8Update, finishAnimacraftEquipmentV8Update, appendProveEquipmentPackDefinitionsV8 } from '@soulidity/sdk'

const id = (n:number) => `0x${n.toString(16).padStart(64,'0')}`
const target = { soulidityCallablePackageId:id(1), protocolConfigId:id(2), runtimeOriginalPackageId:id(30) }
const source = { makerRootId:id(3),definitionRegistryId:id(4),packRegistryId:id(5),makerAccessPassId:id(6),paymentCoinType:'0x2::sui::SUI' }
const scope = { target,soulStateId:id(7),equipmentId:id(8),expectedRevision:'9007199254740993' }
const finalSource = { definitionRegistryId:id(4),baseRegistryId:id(10) }
const base = {kind:'base' as const,itemId:id(9),baseRegistryId:id(10),styleKey:'原色',swatchKey:null}
const external = {kind:'external' as const,itemId:id(11),productId:id(12)}
const selection = {baseRegistryId:id(10),partKey:'body',itemKey:'hat',styleKey:'原色',swatchKey:'红色'}
const protection = {sealRegistryId:id(20),sealPolicyId:id(21),ciphertextBlobCommitment:Array(32).fill(1),certificationCommitment:Array(32).fill(2),sealId:Array(32).fill(3)}
function call(tx:Transaction,n=1) { return tx.getData().commands[n]!.MoveCall! }
function input(tx:Transaction,n:number,c=1) {
  const argument = call(tx,c).arguments[n]
  if (argument.$kind !== 'Input') throw new Error('Expected a transaction input')
  return tx.getData().inputs[argument.Input]!
}
function start() { const tx=new Transaction(); const update=beginAnimacraftEquipmentV8Update(tx,scope); return {tx,params:{...scope,update}} }
function finish(s:ReturnType<typeof start>) { finishAnimacraftEquipmentV8Update(s.tx,{...s.params,...finalSource}) }

describe('Soul-bound equipment transaction ABI',()=>{
  it('composes a real typed Pack proof producer into finish after mutation',async()=>{
    const {tx,params}=start()
    appendClearAnimacraftSelectionV8(tx,{...params,selectionIndex:'0'})
    const proof=appendProveEquipmentPackDefinitionsV8(tx,{runtimeCallablePackageId:id(31),paymentCoinType:source.paymentCoinType,
      equipmentId:scope.equipmentId,...finalSource,releaseId:id(22),bindingIndex:'0'})
    finishAnimacraftEquipmentV8Update(tx,{...params,...finalSource,packDefinitionProofs:[proof]})
    const data=tx.getData()
    expect(data.commands[2].MoveCall).toMatchObject({package:id(31),module:'runtime_v8',function:'prove_equipment_pack_definitions_v8',typeArguments:[source.paymentCoinType]})
    expect(data.commands[2].MoveCall!.arguments).toHaveLength(5)
    expect(bcs.u64().fromBase64(input(tx,4,2).Pure!.bytes)).toBe('0')
    expect(data.commands[3].MakeMoveVec).toMatchObject({type:`${id(30)}::runtime_v8::PackDefinitionProofV8`,elements:[{Result:2}]})
    expect(data.commands[4].MoveCall!.arguments.slice(3)).toMatchObject([{Result:3},{Result:0}])
    const resolved=Transaction.from(JSON.stringify({...data,inputs:data.inputs.map(input=>input.UnresolvedObject
      ? {Object:{SharedObject:{objectId:input.UnresolvedObject.objectId,initialSharedVersion:'1',mutable:input.UnresolvedObject.objectId===scope.equipmentId}}}:input)}))
    const rebuilt=Transaction.fromKind(await resolved.build({onlyTransactionKind:true})).getData()
    expect(rebuilt.commands[3].MakeMoveVec).toEqual(data.commands[3].MakeMoveVec)
  })
  it('opens once, borrows one Result for all mutations and consumes it after the final mutation',()=>{
    const s=start(); const {tx,params}=s
    appendClearAnimacraftSelectionV8(tx,{...params,selectionIndex:'0'})
    appendEquipAnimacraftItemV8(tx,{...params,expectedRevision:'9007199254740994',source,item:external}); finish(s)
    expect(tx.getData().commands.flatMap(c=>c.MoveCall?[c.MoveCall.function]:[])).toEqual(['begin_update_v8','clear_selection_v8','equip_external_v8','finish_update_v8'])
    expect(call(tx,0).arguments).toHaveLength(4)
    expect([0,1,2].map(n=>input(tx,n,0).UnresolvedObject?.objectId)).toEqual([id(7),id(8),id(2)])
    expect(bcs.u64().fromBase64(input(tx,3,0).Pure!.bytes)).toBe(scope.expectedRevision)
    expect(call(tx).arguments[0]).toEqual({Result:0,$kind:'Result'})
    expect(call(tx,2).arguments[0]).toEqual(call(tx).arguments[0]); expect(call(tx,4).arguments[4]).toEqual(call(tx).arguments[0])
    expect([0,1,2].map(n=>input(tx,n,4).UnresolvedObject?.objectId)).toEqual([id(8),id(4),id(10)])
    expect(call(tx,4).arguments).toHaveLength(5); expect(call(tx,4).typeArguments).toEqual([])
    expect(tx.getData().commands[3].MakeMoveVec).toEqual({type:`${id(30)}::runtime_v8::PackDefinitionProofV8`,elements:[]})
    expect(call(tx,4).arguments[3]).toMatchObject({Result:3})
  })
  it.each(['owned','selection'] as const)('encodes exact protected %s without a certifier signer',kind=>{
    const s=start(); const {tx,params}=s
    if(kind==='owned') appendEquipAnimacraftItemV8(tx,{...params,source,item:{...base,protection}})
    else appendSelectAnimacraftBaseStyleV8(tx,{...params,source,selection:{...selection,protection}})
    const offset=kind==='owned'?12:13
    expect(call(tx).function).toBe(kind==='owned'?'equip_protected_base_v8':'select_protected_base_v8')
    expect(call(tx).arguments).toHaveLength(offset+5)
    expect([offset,offset+1].map(n=>input(tx,n).UnresolvedObject?.objectId)).toEqual([id(20),id(21)])
    expect([offset+2,offset+3,offset+4].map(n=>bcs.vector(bcs.u8()).fromBase64(input(tx,n).Pure!.bytes))).toEqual([protection.ciphertextBlobCommitment,protection.certificationCommitment,protection.sealId])
    expect(call(tx).typeArguments).toEqual([source.paymentCoinType]); expect(tx.getData().commands).toHaveLength(2); finish(s)
  })
  it.each(['sealRegistryId','sealPolicyId','ciphertextBlobCommitment','certificationCommitment','sealId'] as const)('rejects invalid protected %s before mutation',field=>{
    const bad=field.endsWith('Id')&&field!=='sealId'?[id(0),'0x1',null]:[[],Array(31).fill(1),Array(33).fill(1),Array(32).fill(-1),Array(32).fill(256),Array(32).fill(1.5),null]
    for(const value of bad){const {tx,params}=start();const p={...protection,[field]:value} as typeof protection
      expect(()=>appendEquipAnimacraftItemV8(tx,{...params,source,item:{...base,protection:p}})).toThrow()
      expect(()=>appendSelectAnimacraftBaseStyleV8(tx,{...params,source,selection:{...selection,protection:p}})).toThrow()
      expect(tx.getData().commands).toHaveLength(1)
    }
  })
  it('encodes Base entitlement keys, optional swatch and exact u64',()=>{
    const s=start();const {tx,params}=s;appendSelectAnimacraftBaseStyleV8(tx,{...params,source,selection})
    expect(call(tx).function).toBe('select_base_v8');expect(call(tx).arguments).toHaveLength(13)
    expect([1,2,3,4,5,6].map(n=>input(tx,n).UnresolvedObject?.objectId)).toEqual([id(8),id(3),id(4),id(5),id(10),id(6)])
    expect(bcs.u64().fromBase64(input(tx,7).Pure!.bytes)).toBe(scope.expectedRevision)
    expect(bcs.option(bcs.u64()).fromBase64(input(tx,8).Pure!.bytes)).toBeNull()
    expect([9,10,11].map(n=>bcs.string().fromBase64(input(tx,n).Pure!.bytes))).toEqual(['body','hat','原色'])
    expect(bcs.option(bcs.string()).fromBase64(input(tx,12).Pure!.bytes)).toBe('红色');finish(s)
  })
  it('encodes Base owned none/swatch and External exact product in one update',()=>{
    const s=start();const {tx,params}=s;appendEquipAnimacraftItemV8(tx,{...params,source,item:base})
    expect(call(tx).function).toBe('equip_base_v8');expect(call(tx).arguments).toHaveLength(12)
    expect(input(tx,6).UnresolvedObject?.objectId).toBe(id(10));expect(bcs.u64().fromBase64(input(tx,8).Pure!.bytes)).toBe(scope.expectedRevision)
    expect(bcs.option(bcs.u64()).fromBase64(input(tx,9).Pure!.bytes)).toBeNull();expect(bcs.string().fromBase64(input(tx,10).Pure!.bytes)).toBe('原色')
    expect(bcs.option(bcs.string()).fromBase64(input(tx,11).Pure!.bytes)).toBeNull()
    appendEquipAnimacraftItemV8(tx,{...params,expectedRevision:'9007199254740994',source,item:{...base,swatchKey:'红色'}})
    expect(bcs.option(bcs.string()).fromBase64(input(tx,11,2).Pure!.bytes)).toBe('红色')
    appendEquipAnimacraftItemV8(tx,{...params,expectedRevision:'9007199254740995',source,item:external})
    expect(call(tx,3).function).toBe('equip_external_v8');expect(call(tx,3).arguments).toHaveLength(10);expect(input(tx,6,3).UnresolvedObject?.objectId).toBe(id(12));finish(s)
  })
  it('encodes Pack exact registry/release/pass and guard',()=>{
    const s=start();const {tx,params}=s;appendSelectAnimacraftPackStyleV8(tx,{...params,source,selection:{...selection,releaseId:id(22),passId:id(23)}})
    expect(call(tx).function).toBe('select_pack_v8');expect(call(tx).arguments).toHaveLength(15)
    expect([5,6,7,8].map(n=>input(tx,n).UnresolvedObject?.objectId)).toEqual([id(10),id(22),id(23),id(6)])
    expect(bcs.u64().fromBase64(input(tx,9).Pure!.bytes)).toBe(scope.expectedRevision);finish(s)
  })
  it('attaches Pack definitions with exact access identities, guard and adjacent revision without a Style',()=>{
    const s=start();const {tx,params}=s
    appendAttachAnimacraftPackDefinitionsV8(tx,{...params,source,pack:{releaseId:id(22),passId:id(23)}})
    expect(call(tx)).toMatchObject({package:id(1),module:'animacraft_equipment_adapter_v8',function:'attach_pack_definitions_v8',typeArguments:[source.paymentCoinType]})
    expect(call(tx).arguments).toHaveLength(9)
    expect(call(tx).arguments[0]).toEqual({Result:0,$kind:'Result'})
    expect([1,2,3,4,5,6,7].map(n=>input(tx,n).UnresolvedObject?.objectId)).toEqual([id(8),id(3),id(4),id(5),id(22),id(23),id(6)])
    expect(bcs.u64().fromBase64(input(tx,8).Pure!.bytes)).toBe(scope.expectedRevision)
    expect(()=>appendClearAnimacraftSelectionV8(tx,{...params,selectionIndex:'0'})).toThrow(/adjacent/)
    appendClearAnimacraftSelectionV8(tx,{...params,expectedRevision:'9007199254740994',selectionIndex:'0'})
    finish(s)
    expect(tx.getData().commands.flatMap(c=>c.MoveCall?[c.MoveCall.function]:[])).toEqual(['begin_update_v8','attach_pack_definitions_v8','clear_selection_v8','finish_update_v8'])
  })
  it('validates Pack attachment identities and exact update source before appending',()=>{
    for(const field of ['releaseId','passId'] as const){
      const {tx,params}=start()
      expect(()=>appendAttachAnimacraftPackDefinitionsV8(tx,{...params,source,pack:{releaseId:id(22),passId:id(23),[field]:'0x1'}})).toThrow(/canonical/)
      expect(tx.getData().commands).toHaveLength(1)
    }
    const s=start();const {tx,params}=s
    appendAttachAnimacraftPackDefinitionsV8(tx,{...params,source,pack:{releaseId:id(22),passId:id(23)}})
    expect(()=>appendAttachAnimacraftPackDefinitionsV8(tx,{...params,expectedRevision:'9007199254740994',source:{...source,definitionRegistryId:id(99)},pack:{releaseId:id(22),passId:id(23)}})).toThrow(/source must remain exact/)
    expect(tx.getData().commands).toHaveLength(2)
    expect(()=>finishAnimacraftEquipmentV8Update(tx,{...params,...finalSource,definitionRegistryId:id(99)})).toThrow(/source must remain exact/)
    finish(s)
    expect(()=>appendAttachAnimacraftPackDefinitionsV8(tx,{...params,expectedRevision:'9007199254740994',source,pack:{releaseId:id(22),passId:id(23)}})).toThrow(/open handle/)
  })
  it.each(['base','external','selection'] as const)('removes %s without access/payment/active-source dependency',kind=>{
    const s=start();const {tx,params}=s
    if(kind==='selection')appendClearAnimacraftSelectionV8(tx,{...params,selectionIndex:'499'})
    else appendUnequipAnimacraftItemV8(tx,{...params,kind,itemId:id(9)})
    expect(call(tx).function).toBe(kind==='selection'?'clear_selection_v8':`unequip_${kind}_v8`)
    expect(call(tx).arguments).toHaveLength(4);expect(call(tx).typeArguments).toEqual([])
    expect(bcs.u64().fromBase64(input(tx,kind==='selection'?2:3).Pure!.bytes)).toBe(scope.expectedRevision)
    if(kind==='selection')expect(bcs.u64().fromBase64(input(tx,3).Pure!.bytes)).toBe('499')
    finish(s);expect(tx.getData().inputs.flatMap(i=>i.UnresolvedObject?[i.UnresolvedObject.objectId]:[])).toEqual([id(7),id(8),id(2),...(kind==='selection'?[]:[id(9)]),id(4),id(10)])
    const bad=start();expect(()=>appendClearAnimacraftSelectionV8(bad.tx,{...bad.params,selectionIndex:'500'})).toThrow();expect(bad.tx.getData().commands).toHaveLength(1)
  })
  it('preserves create and close native ABI without guard',()=>{
    const tx=buildCreateAnimacraftEquipmentV8Tx({target,source,soulStateId:id(7),provenanceBindingId:id(13)})
    expect(call(tx,0)).toMatchObject({package:id(1),module:'animacraft_equipment_adapter_v8',function:'create_equipment_v8',typeArguments:[source.paymentCoinType]})
    expect(call(tx,0).arguments).toHaveLength(7);expect(tx.getData().commands).toHaveLength(1)
    expect([0,1,2,3,4,5,6].map(n=>input(tx,n,0).UnresolvedObject?.objectId)).toEqual([id(7),id(13),id(3),id(2),id(4),id(5),id(6)])
    const close=buildCloseEmptyAnimacraftEquipmentV8Tx(scope);expect(call(close,0).function).toBe('close_empty_equipment_v8');expect(call(close,0).arguments).toHaveLength(4);expect(call(close,0).typeArguments).toEqual([]);expect(close.getData().commands).toHaveLength(1)
  })
  it.each([base,{kind:'selection' as const,selectionIndex:'0'}])('atomically replaces $kind using one guard and adjacent exact revisions',previous=>{
    for(const next of [external,{...base,protection}]){const tx=buildReplaceAnimacraftItemV8Tx({...scope,source,baseRegistryId:id(10),previous,next})
      expect(tx.getData().commands).toHaveLength(5);expect(call(tx).function).toBe(previous.kind==='base'?'unequip_base_v8':'clear_selection_v8')
      expect(call(tx,2).function).toBe(next.kind==='base'?'equip_protected_base_v8':'equip_external_v8');expect(call(tx,4).function).toBe('finish_update_v8')
      expect(bcs.u64().fromBase64(input(tx,previous.kind==='base'?3:2).Pure!.bytes)).toBe(scope.expectedRevision);expect(bcs.u64().fromBase64(input(tx,8,2).Pure!.bytes)).toBe('9007199254740994')
      expect(call(tx).arguments[0]).toEqual(call(tx,2).arguments[0]);expect(input(tx,1)).toEqual(input(tx,1,2));expect(tx.getData().commands.some(c=>c.TransferObjects)).toBe(false)
      if(next.kind==='base')expect(bcs.vector(bcs.u8()).fromBase64(input(tx,16,2).Pure!.bytes)).toEqual(protection.sealId)
    }
  })
  it.each(['-1','01','1.2','18446744073709551616','',9007199254740992])('rejects invalid exact revision %s',value=>{
    expect(()=>buildCloseEmptyAnimacraftEquipmentV8Tx({...scope,expectedRevision:value as string})).toThrow(/u64/)
    expect(()=>beginAnimacraftEquipmentV8Update(new Transaction(),{...scope,expectedRevision:value as string})).toThrow(/u64/)
  })
  it.each(['0x1',id(0),''])('rejects noncanonical/zero ID %s',value=>{expect(()=>buildCloseEmptyAnimacraftEquipmentV8Tx({...scope,equipmentId:value})).toThrow(/canonical/)})
  it('rejects invalid item/swatch/kind and overflow without appending mutation',()=>{
    for(const item of [{...base,styleKey:''},{...base,styleKey:'界'.repeat(43)},{...base,swatchKey:undefined},{...external,kind:'physical'}]){
      const {tx,params}=start();expect(()=>appendEquipAnimacraftItemV8(tx,{...params,source,item:item as typeof base})).toThrow();expect(tx.getData().commands).toHaveLength(1)
    }
    expect(()=>buildReplaceAnimacraftItemV8Tx({...scope,source,baseRegistryId:id(10),previous:base,next:external,expectedRevision:'18446744073709551614'})).toThrow(/overflow/)
  })
  it('rejects duplicate begin, forged/cross-tx handles and changed scope',()=>{
    const {tx,params}=start();expect(()=>beginAnimacraftEquipmentV8Update(tx,scope)).toThrow(/already began/)
    for(const bad of [{...params,update:undefined},{...params,update:{}},{...params,equipmentId:id(50)},{...params,soulStateId:id(50)},
      {...params,target:{...target,protocolConfigId:id(50)}},{...params,target:{...target,soulidityCallablePackageId:id(50)}},
      {...params,target:{...target,runtimeOriginalPackageId:id(50)}}]){
      expect(()=>appendClearAnimacraftSelectionV8(tx,{...bad,selectionIndex:'0'} as any)).toThrow(/open handle/)
    }
    expect(()=>appendClearAnimacraftSelectionV8(new Transaction(),{...params,selectionIndex:'0'})).toThrow(/open handle/);expect(tx.getData().commands).toHaveLength(1)
  })
  it('rejects stale/skipped revisions, mutation after finish and double consume',()=>{
    const s=start();const {tx,params}=s
    expect(()=>appendClearAnimacraftSelectionV8(tx,{...params,selectionIndex:'0',expectedRevision:'9007199254740994'})).toThrow(/adjacent/)
    appendClearAnimacraftSelectionV8(tx,{...params,selectionIndex:'0'});expect(()=>appendClearAnimacraftSelectionV8(tx,{...params,selectionIndex:'0'})).toThrow(/adjacent/)
    finish(s);expect(()=>finish(s)).toThrow(/open handle/);expect(()=>appendClearAnimacraftSelectionV8(tx,{...params,selectionIndex:'0',expectedRevision:'9007199254740994'})).toThrow(/open handle/)
    expect(tx.getData().commands).toHaveLength(4)
  })
  it('rejects mixed registry sources and mismatched final validation source without consuming the guard',()=>{
    const s=start();const {tx,params}=s
    appendSelectAnimacraftBaseStyleV8(tx,{...params,source,selection})
    for(const updateSource of [{...finalSource,definitionRegistryId:id(50)},{...finalSource,baseRegistryId:id(50)}]) {
      expect(()=>finishAnimacraftEquipmentV8Update(tx,{...params,...updateSource})).toThrow(/source must remain exact/)
    }
    expect(()=>appendSelectAnimacraftBaseStyleV8(tx,{...params,expectedRevision:'9007199254740994',source:{...source,definitionRegistryId:id(50)},selection})).toThrow(/source must remain exact/)
    expect(()=>appendSelectAnimacraftPackStyleV8(tx,{...params,expectedRevision:'9007199254740994',source,selection:{...selection,baseRegistryId:id(50),releaseId:id(22),passId:id(23)}})).toThrow(/source must remain exact/)
    expect(tx.getData().commands).toHaveLength(2);finish(s);expect(tx.getData().commands).toHaveLength(4)
  })
  it('builds real transaction-kind BCS preserving the begin Result through mutations and finish',async()=>{
    const s=start();const {tx,params}=s
    appendClearAnimacraftSelectionV8(tx,{...params,selectionIndex:'0'})
    appendEquipAnimacraftItemV8(tx,{...params,source,expectedRevision:'9007199254740994',item:{...base,protection}});finish(s)
    const data=tx.getData()
    const resolved=Transaction.from(JSON.stringify({...data,inputs:data.inputs.map(input=>input.UnresolvedObject
      ? {Object:{SharedObject:{objectId:input.UnresolvedObject.objectId,initialSharedVersion:'1',mutable:input.UnresolvedObject.objectId===scope.equipmentId}}}:input)}))
    const bytes=await resolved.build({onlyTransactionKind:true})
    const rebuilt=Transaction.fromKind(bytes).getData()
    expect(rebuilt.commands.flatMap(c=>c.MoveCall?[c.MoveCall.function]:[])).toEqual(['begin_update_v8','clear_selection_v8','equip_protected_base_v8','finish_update_v8'])
    expect(rebuilt.commands[1].MoveCall!.arguments[0]).toMatchObject({Result:0})
    expect(rebuilt.commands[2].MoveCall!.arguments[0]).toMatchObject({Result:0})
    expect(rebuilt.commands[4].MoveCall!.arguments[4]).toMatchObject({Result:0})
  })
})
