import {expect,it,vi} from 'vitest'
import {deriveDynamicFieldID} from '@mysten/sui/utils'
import {readBrowserOwnedEquipmentPage} from '../../web/lib/animacraft/browser-owned-equipment'
import {equipmentMarketOperationFixture,emid} from './fixtures/equipment-market-operation'
import {EquipmentBaseItemBcs,EquipmentExternalItemBcs,EquipmentKeyBcs,EquipmentBindingFieldBcs,EquipmentPointerBcs} from '../../web/lib/animacraft/native-equipment'
import {EquipmentExternalProductBcs} from '../../web/lib/animacraft/native-equipment-source-bcs'
import type {BrowserNativeEquipmentMarketConfig} from '../../web/lib/animacraft/browser-native-equipment-market-read'
import {MAINNET_GENESIS_DIGEST} from '../../web/lib/animacraft/mainnet-chain'

async function fixture(kind:'base'|'external'='base',equipped=false){
  const f=await equipmentMarketOperationFixture({kind,equipped}),type=f.objects.get(f.itemId).objectType
  const page={objects:[{objectId:f.itemId,type,owner:{$kind:'AddressOwner',AddressOwner:f.owner}}],hasNextPage:false,cursor:null as string|null}
  const list=vi.fn(async(_request:unknown)=>structuredClone(page));(f.client.core as any).listOwnedObjects=list
  f.client.ledgerService.getServiceInfo=vi.fn(async()=>({response:{chainId:MAINNET_GENESIS_DIGEST}})) as never
  const read=(cursor?:string,signal?:AbortSignal)=>readBrowserOwnedEquipmentPage({owner:f.owner,kind,cursor,signal},
    {config:()=>({target:f.target}) as BrowserNativeEquipmentMarketConfig,client:()=>f.client})
  return {...f,page,list,read,type}
}
it.each(['base','external'] as const)('discovers and authenticates unlocked %s without owning any Soul',async kind=>{
  const f=await fixture(kind);f.objects.delete(emid(12));f.objects.delete(emid(14))
  const result=await f.read()
  expect(result).toMatchObject({owner:f.owner,kind,hasNextPage:false,cursor:null,notAuthorization:true})
  expect(result.rows).toHaveLength(1)
  expect(result.rows[0]).toMatchObject({request:{actor:f.owner,rootId:f.rootId,itemId:f.itemId,kind},snapshot:{available:{list:true},lock:null,removal:null}})
  expect(f.list).toHaveBeenCalledWith({owner:f.owner,type:f.type,limit:20,cursor:undefined})
})
it.each(['base','external'] as const)('derives the authenticated Soul scope for locked %s without selecting that Soul',async kind=>{
  const f=await fixture(kind,true),result=await f.read()
  expect(result.rows).toHaveLength(1)
  expect(result.rows[0].request.equipmentScope).toEqual({soulId:emid(12),stateId:emid(14)})
  expect(result.rows[0].snapshot.available.list).toBe(true)
  expect(result.rows[0].snapshot.removal).toMatchObject({sellSoul:false})
  expect(result.rows[0].snapshot.removal?.equipment?.plan.removals).toEqual([{kind,itemId:f.itemId}])
})
it('shows a plain Maker-loadout locked instance as unavailable instead of guessing a Soul',async()=>{
  const f=await fixture('base',true),key=`${emid(70)}::runtime_v8::SoulEquipmentKeyV8`,
    field=deriveDynamicFieldID(emid(80),key,EquipmentKeyBcs.serialize({dummy_field:false}).toBytes())
  f.objects.delete(field)
  const result=await f.read()
  expect(result.rows[0].request.equipmentScope).toBeUndefined()
  expect(result.rows[0].snapshot).toMatchObject({available:{list:false},removal:null,lock:{equipmentId:emid(80)}})
})
it.each(['index owner','index type','duplicate','holder','raw owner','raw type','chain','pin','cursor','repeated cursor','oversize'])('rejects unauthenticated inventory page: %s',async reason=>{
  const f=await fixture()
  if(reason==='index owner')f.page.objects[0].owner.AddressOwner=emid(999)
  if(reason==='index type')f.page.objects[0].type=`${emid(999)}::runtime_v8::OwnedBaseItemV8`
  if(reason==='duplicate')f.page.objects.push(f.page.objects[0])
  if(reason==='oversize')f.page.objects=Array(21).fill(f.page.objects[0])
  if(reason==='holder')f.set(f.itemId,EquipmentBaseItemBcs,row=>{row.holder=emid(999)})
  if(reason==='raw owner')f.objects.get(f.itemId).owner={kind:1,address:emid(999)}
  if(reason==='raw type')f.objects.get(f.itemId).objectType=f.page.objects[0].type.replace('OwnedBaseItemV8','OwnedExternalItemV8')
  if(reason==='chain')f.client.ledgerService.getServiceInfo=vi.fn(async()=>({response:{chainId:'wrong'}})) as never
  if(reason==='pin')f.target.runtime!.callableDigest=f.record.digest
  if(reason==='cursor'||reason==='repeated cursor'){f.page.hasNextPage=true;f.page.cursor=reason==='cursor'?'bad!':'AQ=='}
  await expect(f.read(reason==='repeated cursor'?'AQ==':undefined)).rejects.toThrow()
})
it.each(['root','identity','commitment','asset','owner kind','type','missing'])('rejects invalid External product: %s',async reason=>{
  const f=await fixture('external'),id=emid(101),raw=f.objects.get(id)
  if(reason==='root')f.set(id,EquipmentExternalProductBcs,row=>{row.root_id=emid(999)})
  if(reason==='identity')f.set(id,EquipmentExternalProductBcs,row=>{row.id=emid(999)})
  if(reason==='commitment')f.set(id,EquipmentExternalProductBcs,row=>{row.content_commitment[0]^=1})
  if(reason==='asset')f.set(f.itemId,EquipmentExternalItemBcs,row=>{row.asset_content_commitment[0]^=1})
  if(reason==='owner kind')raw.owner={kind:4}
  if(reason==='type')raw.objectType=raw.objectType.replace('ExternalItemProductV8','MakerLoadoutV8')
  if(reason==='missing')f.objects.delete(id)
  await expect(f.read()).rejects.toThrow()
})
it.each(['holder','epoch','protocol','reverse pointer','slot'])('rejects an invalid equipped binding: %s',async reason=>{
  const f=await fixture('base',true),key=`${emid(70)}::runtime_v8::SoulEquipmentKeyV8`,
    field=deriveDynamicFieldID(emid(80),key,EquipmentKeyBcs.serialize({dummy_field:false}).toBytes())
  if(reason==='holder')f.set(field,EquipmentBindingFieldBcs,row=>{row.value.holder=emid(999)})
  if(reason==='epoch')f.set(field,EquipmentBindingFieldBcs,row=>{row.value.ownership_epoch='99'})
  if(reason==='protocol')f.set(field,EquipmentBindingFieldBcs,row=>{row.value.protocol_config_id=emid(999)})
  if(reason==='reverse pointer')f.set(deriveDynamicFieldID(emid(14),'u8',new Uint8Array([10])),EquipmentPointerBcs,row=>{row.value=emid(999)})
  if(reason==='slot')f.set(f.itemId,EquipmentBaseItemBcs,row=>{row.equip_lock!.selection_index='99'})
  await expect(f.read()).rejects.toThrow()
})
it('keeps pagination explicit and sends only the requested cursor',async()=>{
  const f=await fixture();f.page.hasNextPage=true;f.page.cursor='Ag=='
  const result=await f.read('AQ==')
  expect(result).toMatchObject({hasNextPage:true,cursor:'Ag=='})
  expect(f.list).toHaveBeenCalledTimes(1);expect(f.list.mock.calls[0][0]).toMatchObject({cursor:'AQ=='})
})
it('rejects changed inventory refs at final verification',async()=>{
  const f=await fixture(),get=f.client.ledgerService.getObject.bind(f.client.ledgerService);let changed=false
  f.client.ledgerService.getObject=(async(request:any)=>{
    const answer=await get(request)
    if(request.objectId===f.itemId&&!request.readMask?.paths.includes('contents')){
      changed=true;const different=structuredClone(answer);different.response.object!.version=99n;return different
    }
    return answer
  }) as never
  await expect(f.read()).rejects.toThrow();expect(changed).toBe(true)
})
it('honors an already aborted read before creating the client',async()=>{
  const f=await fixture(),abort=new AbortController();abort.abort()
  await expect(f.read(undefined,abort.signal)).rejects.toThrow();expect(f.list).not.toHaveBeenCalled()
})
it('keeps valid nontransferable equipped items visible without blocking other saleable items on the page',async()=>{
  const f=await fixture('external',true),product=EquipmentExternalProductBcs.parse(f.objects.get(emid(101)).contents.value),
    item=EquipmentExternalItemBcs.parse(f.objects.get(f.itemId).contents.value)
  f.put(emid(201),f.runtimeType('ExternalItemProductV8'),EquipmentExternalProductBcs,{...product,id:emid(201)})
  f.put(emid(202),f.type,EquipmentExternalItemBcs,{...item,id:emid(202),product_id:emid(201),equip_lock:null},1,f.owner)
  f.page.objects.push({objectId:emid(202),type:f.type,owner:{$kind:'AddressOwner',AddressOwner:f.owner}})
  f.set(emid(101),EquipmentExternalProductBcs,row=>{row.transferable=false})
  f.set(f.itemId,EquipmentExternalItemBcs,row=>{row.transferable=false})
  const result=await f.read()
  expect(result.rows).toHaveLength(2)
  expect(result.rows[0].snapshot).toMatchObject({available:{list:false},lock:{equipmentId:emid(80)},removal:null})
  expect(result.rows[1].snapshot).toMatchObject({available:{list:true},lock:null,removal:null})
})
