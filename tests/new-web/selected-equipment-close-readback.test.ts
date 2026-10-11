import {expect,it,vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {Inputs,Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {deriveDynamicFieldID,fromBase64,toBase58,toBase64} from '@mysten/sui/utils'
import {selectedMarketSaleEvidenceFixture} from './fixtures/selected-market-sale-evidence'
import {emid} from './fixtures/equipment-market-operation'
import {buildSelectedMarketSaleTransaction} from '../../web/lib/animacraft/selected-market-sale-snapshot'
import {selectedMarketSaleInputRoles,validateSelectedMarketSaleOperationRecord} from '../../web/lib/animacraft/selected-market-sale-operation'
import {querySelectedMarketSaleEvidence} from '../../web/lib/animacraft/selected-market-sale-evidence'
import {confirmAuthenticatedClosedEquipmentGroup} from '../../web/lib/animacraft/selected-equipment-close-readback'
import {EquipmentReadSet,EquipmentKeyBcs,EquipmentBaseItemBcs,EquipmentExternalItemBcs,EquipmentLoadoutBcs,EquipmentBindingFieldBcs} from '../../web/lib/animacraft/native-equipment'
import {createNativeMarketReadbackSession} from '../../web/lib/animacraft/browser-native-market-readback'
import {EquipmentBaseHolderKeyBcs,EquipmentBaseOwnershipBcs} from '../../web/lib/animacraft/native-equipment-source-bcs'
import {NativeSoulStateBcs,NativeSoulBcs,NativeSoulBindingBcs} from '../../web/lib/animacraft/native-receive'
import {NativeMarketListingBcs} from '../../web/lib/animacraft/native-market'
import {SoulPublicKioskBcs} from '@soulidity/sdk'
import {fixtureKioskItem} from './fixtures/native-receive'
import {equipmentMarketReadbackFixture} from './fixtures/equipment-market-readback'
import {EquipmentMarketListingBcs} from '../../web/lib/animacraft/native-equipment-market-bcs'
import {equipmentOperationQuote} from '../../web/lib/animacraft/equipment-market-operation'
import {fromHex} from '@mysten/sui/utils'
import {confirmBrowserSelectedMarketSale} from '../../web/lib/animacraft/browser-selected-market-sale-readback'

const LayoutBcs=bcs.struct('Field',{id:bcs.Address,name:EquipmentKeyBcs,value:bcs.bool()})
async function fixture(selected=false){
  const f=await selectedMarketSaleEvidenceFixture(),r=f.record,group=r.snapshot.equipment[0],loadoutId=group.equipment!.plan.scope.equipmentId
  if(!selected){r.snapshot.rows=r.snapshot.rows.filter(row=>row.assetType==='soul');group.selectedItems=[]
    f.events.splice(1)
    const roles=selectedMarketSaleInputRoles(r.snapshot),data=buildSelectedMarketSaleTransaction(r.snapshot).getData()
    data.inputs=data.inputs.map(input=>input.UnresolvedObject?(roles.owned.has(input.UnresolvedObject.objectId)
      ?Inputs.ObjectRef({objectId:input.UnresolvedObject.objectId,version:'2',digest:f.target.outputCallableDigest})
      :Inputs.SharedObjectRef({objectId:input.UnresolvedObject.objectId,initialSharedVersion:'1',mutable:roles.mutable.has(input.UnresolvedObject.objectId)})):input)
    const tx=Transaction.from(JSON.stringify(data));tx.setSender(f.owner);tx.setGasOwner(f.owner);tx.setGasPrice(1);tx.setGasBudget(100000)
    tx.setGasPayment([{objectId:emid(950),version:'2',digest:f.target.outputCallableDigest}]);tx.setExpiration({Epoch:9})
    const bytes=await tx.build();r.bytes=toBase64(bytes);r.digest=TransactionDataBuilder.getDigestFromBytes(bytes)
  }
  r.phase='SUCCEEDED';r.syncStatus='PENDING';validateSelectedMarketSaleOperationRecord(r)
  const objects=f.objects,history=new Map<string,any>(),key=(id:string,version:bigint)=>`${id}:${version}`
  const runtime=objects.get(f.target.runtime!.callablePackageId)
  runtime.package.typeOrigins.push({moduleName:'runtime_v8',datatypeName:'SoulEquipmentLayoutKeyV8',packageId:f.target.runtime!.originalPackageId})
  for(const p of f.packages)for(const origin of p.package.typeOrigins){
    const raw=objects.get(p.objectId)
    if(!raw.package.typeOrigins.some((o:any)=>o.moduleName===origin.moduleName&&o.datatypeName===origin.datatypeName))raw.package.typeOrigins.push(origin)
  }
  const rt=(name:string)=>`${f.target.runtime!.originalPackageId}::runtime_v8::${name}`
  const pointerId=deriveDynamicFieldID(group.stateId,'u8',new Uint8Array([10])),bindingId=deriveDynamicFieldID(loadoutId,rt('SoulEquipmentKeyV8'),new Uint8Array([0])),
    layoutId=deriveDynamicFieldID(loadoutId,rt('SoulEquipmentLayoutKeyV8'),new Uint8Array([0]))
  objects.set(layoutId,{objectId:layoutId,version:2n,digest:f.target.outputCallableDigest,owner:{kind:2,address:loadoutId},
    objectType:`0x2::dynamic_field::Field<${rt('SoulEquipmentLayoutKeyV8')},bool>`,contents:{value:LayoutBcs.serialize({id:layoutId,name:{dummy_field:false},value:true}).toBytes()}})
  for(const raw of objects.values()){if(raw.owner?.kind===3)raw.owner.version=1n;history.set(key(raw.objectId,raw.version),structuredClone(raw))}
  const effects=f.effects;effects.V2.transactionDigest=r.digest;effects.V2.changedObjects=[]
  for(const id of [loadoutId,pointerId,bindingId,layoutId]){
    const raw=objects.get(id),owner=id===loadoutId?{Shared:{initialSharedVersion:'1'}}:{ObjectOwner:raw.owner.address}
    effects.V2.changedObjects.push([id,{inputState:{Exist:[[String(raw.version),raw.digest],owner]},outputState:{NotExist:true},idOperation:{Deleted:true}}])
    objects.delete(id)
  }
  const selectedListings=new Map(group.selectedItems.map((row,index)=>[row.itemId,emid(901+index)]))
  for(const [index,removal] of group.equipment!.plan.removals.entries()){
    if(removal.kind==='selection')continue
    const raw=objects.get(removal.itemId),old=structuredClone(raw),codec=removal.kind==='base'?EquipmentBaseItemBcs:EquipmentExternalItemBcs,
      item:any=codec.parse(raw.contents.value)
    item.equip_lock=null;raw.contents.value=(codec as typeof EquipmentBaseItemBcs).serialize(item).toBytes()
    raw.version=3n;raw.digest=toBase58(new Uint8Array(32).fill(20+index));raw.previousTransaction=r.digest
    raw.owner={kind:1,address:selectedListings.get(removal.itemId)??f.owner}
    history.set(key(raw.objectId,3n),structuredClone(raw))
    effects.V2.changedObjects.push([raw.objectId,{inputState:{Exist:[[String(old.version),old.digest],{AddressOwner:f.owner}]},
      outputState:{ObjectWrite:[raw.digest,{AddressOwner:raw.owner.address}]},idOperation:{None:true}}])
  }
  f.ledger.digest=r.digest;f.ledger.transaction={digest:r.digest,bcs:{value:fromBase64(r.bytes)}};f.ledger.effects.transactionDigest=r.digest;f.refresh()
  const get=vi.fn(async(p:any)=>({response:{object:p.version===undefined?objects.get(p.objectId):history.get(key(p.objectId,p.version))}}))
  const client={...f.rawClient,ledgerService:{...f.rawClient.ledgerService,...f.client.ledgerService,getObject:get,
    batchGetObjects:async({requests}:any)=>({response:{objects:requests.map((p:any)=>{const raw=p.version===undefined?objects.get(p.objectId):history.get(key(p.objectId,p.version));
      return {result:raw?{oneofKind:'object',object:raw}:{oneofKind:'error',error:{code:5}}}})}})}} as unknown as SuiGrpcClient
  async function addWholeSaleOutputs(){
    const row=r.snapshot.rows[0];if(row.assetType!=='soul')throw new Error('Soul fixture expected')
    const s=row.snapshot,pkg=objects.get(f.target.soulidityCallablePackageId).package
    for(const name of ['MarketConfigV2','SoulListing'])if(!pkg.typeOrigins.some((o:any)=>o.moduleName==='market'&&o.datatypeName===name))
      pkg.typeOrigins.push({moduleName:'market',datatypeName:name,packageId:f.target.soulidityOriginalPackageId})
    const edit=(id:string,codec:any,change:(v:any)=>void)=>{const raw=objects.get(id),v=codec.parse(raw.contents.value);change(v);raw.contents.value=codec.serialize(v).toBytes();return raw}
    const state=edit(s.stateId,NativeSoulStateBcs,v=>Object.assign(v,{creator:s.creator,creator_royalty_bps:s.soulCreatorRoyaltyBps,
      current_owner:f.owner,current_kiosk_id:s.kioskId,is_listed:true,ownership_epoch:s.ownershipEpoch}))
    state.version=3n;state.previousTransaction=r.digest
    edit(s.soulId,NativeSoulBcs,v=>{v.creator=s.creator})
    edit(s.bindingId,NativeSoulBindingBcs,v=>{v.original_holder=s.creator;v.maker_creator=s.makerCreator;
      v.rights.soul_creator_royalty_bps=s.soulCreatorRoyaltyBps;v.rights.maker_source_royalty_bps=s.makerSourceRoyaltyBps})
    fixtureKioskItem(objects,s.kioskId,s.soulId)
    objects.set(s.kioskId,{objectId:s.kioskId,version:3n,digest:f.target.outputCallableDigest,owner:{kind:3,version:1n},objectType:'0x2::kiosk::Kiosk',
      contents:{value:SoulPublicKioskBcs.serialize({id:s.kioskId,profits:'0',owner:f.owner,item_count:1,allow_extensions:true}).toBytes()}})
    history.set(key(s.stateId,3n),structuredClone(state))
    const listingId=emid(900),listing={objectId:listingId,version:3n,digest:f.target.outputCallableDigest,previousTransaction:r.digest,
      owner:{kind:3,version:3n},objectType:`${f.target.soulidityOriginalPackageId}::market::SoulListing`,contents:{value:NativeMarketListingBcs.serialize({
        id:listingId,version:'8',soul_id:s.soulId,state_id:s.stateId,seller:f.owner,seller_kiosk_id:s.kioskId,price:row.priceAtomic,
        creator:s.creator,creator_royalty_bps:s.soulCreatorRoyaltyBps,collection_id:null,is_active:true,
        purchase_cap:{id:emid(980),kiosk_id:s.kioskId,item_id:s.soulId,min_price:'0'},
      }).toBytes()}}
    objects.set(listingId,listing);history.set(key(listingId,3n),structuredClone(listing))
    effects.V2.changedObjects.push([s.stateId,{inputState:{Exist:[['2',f.target.outputCallableDigest],{Shared:{initialSharedVersion:'1'}}]},
      outputState:{ObjectWrite:[state.digest,{Shared:{initialSharedVersion:'1'}}]},idOperation:{None:true}}])
    const created=(id:string,digest:string)=>[id,{inputState:{NotExist:true},outputState:{ObjectWrite:[digest,{Shared:{initialSharedVersion:'3'}}]},idOperation:{Created:true}}]
    effects.V2.changedObjects.push(created(listingId,listing.digest))
    for(const [index,row] of r.snapshot.rows.entries()){
      if(row.assetType!=='equipment')continue
      const source=await equipmentMarketReadbackFixture('list',row.snapshot.asset.kind,true),raw=structuredClone(source.listing),id=emid(900+index)
      const v=EquipmentMarketListingBcs.parse(raw.contents.value),q=equipmentOperationQuote(row.snapshot,row.priceAtomic)
      v.id=id;v.custody.listing_id=id;v.gross_atomic=q.grossAtomic;v.protocol_atomic=q.protocolAtomic;v.seller_atomic=q.sellerAtomic;v.quote_commitment=[...fromHex(q.commitment)]
      raw.objectId=id;raw.previousTransaction=r.digest;raw.contents.value=EquipmentMarketListingBcs.serialize(v).toBytes()
      objects.set(id,raw);history.set(key(id,3n),structuredClone(raw));effects.V2.changedObjects.push(created(id,raw.digest))
    }
    f.refresh()
  }
  async function confirm(after?:()=>void){
    const signal=AbortSignal.timeout(25000),session=createNativeMarketReadbackSession(client,signal,3)
    const proof=await querySelectedMarketSaleEvidence(r,session.client);if(proof.status!=='SUCCEEDED')throw new Error('No proof')
    const context={client:session.client,signal,reads:new EquipmentReadSet(session.client,true),historyReads:new EquipmentReadSet(session.client)}
    const result=await confirmAuthenticatedClosedEquipmentGroup({actor:f.owner,ownershipEpoch:'0',rootId:f.rootId,target:f.target,preparation:group,
      bytes:r.bytes,digest:r.digest,effects:proof.effects,selectedListings},context)
    after?.();await context.reads.verify();await session.verify();return result
  }
  function useV1(){
    const v2=bcs.TransactionEffects.parse(f.ledger.effects.bcs.value).V2!
    type V1=NonNullable<ReturnType<typeof bcs.TransactionEffects.parse>['V1']>
    const v1:V1={status:v2.status,executedEpoch:v2.executedEpoch,gasUsed:v2.gasUsed,modifiedAtVersions:[],sharedObjects:[],transactionDigest:r.digest,
      created:[],mutated:[],unwrapped:[],deleted:[],unwrappedThenDeleted:[],wrapped:[],
      gasObject:[{objectId:emid(950),version:'3',digest:f.target.outputCallableDigest},{$kind:'AddressOwner',AddressOwner:f.owner}],eventsDigest:v2.eventsDigest,dependencies:[]}
    for(const [id,change] of v2.changedObjects){
      const before=change.inputState.Exist!,output=change.outputState.ObjectWrite
      v1.modifiedAtVersions.push([id,before[0][0]])
      if(before[1].Shared)v1.sharedObjects.push({objectId:id,version:before[0][0],digest:before[0][1]})
      if(output)v1.mutated.push([{objectId:id,version:'3',digest:output[0]},output[1]])
      else v1.deleted.push({objectId:id,version:'3',digest:toBase58(new Uint8Array(32).fill(99))})
    }
    const refreshV1=()=>{f.ledger.effects.bcs.value=bcs.TransactionEffects.serialize({V1:v1}).toBytes()}
    refreshV1();return {v1,refreshV1}
  }
  return {...f,group,loadoutId,pointerId,bindingId,layoutId,history,key,get,confirm,selectedListings,useV1,addWholeSaleOutputs,
    confirmBatch:()=>confirmBrowserSelectedMarketSale(r,{target:f.target},{client})}
}
it.each([false,true])('proves exact closure and removed-instance ownership; instances selected=%s',async selected=>{
  const f=await fixture(selected);expect(await f.confirm()).toBe('COMPLETE')
  for(const id of [f.loadoutId,f.pointerId,f.bindingId,f.layoutId])expect(f.get.mock.calls.some(([p])=>p.objectId===id&&p.version===2n)).toBe(true)
})
it.each([false,true])('runs all actual row/group evaluators in one closed-Soul sale; equipment selected=%s',async selected=>{
  const f=await fixture(selected);await f.addWholeSaleOutputs()
  expect(await f.confirmBatch()).toBe('COMPLETE')
})
it('whole mixed readback remains pending when closure proof is absent after all listing rows pass',async()=>{
  const f=await fixture(true);await f.addWholeSaleOutputs()
  f.effects.V2.changedObjects=f.effects.V2.changedObjects.filter(([id]:any[])=>id!==f.layoutId);f.refresh()
  await expect(f.confirmBatch()).rejects.toThrow('effect missing');expect(f.record.syncStatus).toBe('PENDING')
})
it('does not skip equipment evidence when the selected Soul result has already been superseded',async()=>{
  const f=await fixture(true);await f.addWholeSaleOutputs()
  const raw=f.objects.get(f.group.stateId),state=NativeSoulStateBcs.parse(raw.contents.value)
  state.is_listed=false;raw.version=4n;raw.digest=toBase58(new Uint8Array(32).fill(44));raw.contents.value=NativeSoulStateBcs.serialize(state).toBytes()
  f.history.delete(f.key(emid(901),3n))
  await expect(f.confirmBatch()).rejects.toThrow();expect(f.record.syncStatus).toBe('PENDING')
})
it.each(['loadoutId','pointerId','bindingId','layoutId'] as const)('rejects missing %s deletion',async field=>{
  const f=await fixture();f.effects.V2.changedObjects=f.effects.V2.changedObjects.filter(([id]:any[])=>id!==f[field]);f.refresh()
  await expect(f.confirm()).rejects.toThrow()
})
it.each(['owner','digest','version','kind','output'] as const)('rejects substituted deleted loadout %s',async change=>{
  const f=await fixture(),row=f.effects.V2.changedObjects[0][1]
  if(change==='owner')row.inputState.Exist[1]={AddressOwner:f.owner}
  if(change==='digest')row.inputState.Exist[0][1]=f.record.digest
  if(change==='version')row.inputState.Exist[0][0]='1'
  if(change==='kind')row.idOperation={None:true}
  if(change==='output')row.outputState={ObjectWrite:[f.record.digest,{Shared:{initialSharedVersion:'1'}}]}
  f.refresh();await expect(f.confirm()).rejects.toThrow()
})
it.each(['holder','epoch','lock','owner','contents'] as const)('rejects changing unchecked instance %s in the sale transaction',async change=>{
  const f=await fixture(),id=emid(84),raw=f.history.get(f.key(id,3n)),item=EquipmentBaseItemBcs.parse(raw.contents.value)
  if(change==='holder')item.holder=emid(999);if(change==='epoch')item.ownership_epoch='1'
  if(change==='lock')item.equip_lock={loadout_id:f.loadoutId,equip_revision:'1',selection_index:'0'}
  if(change==='contents')item.item_payload_commitment=Array(32).fill(33)
  if(change==='owner')raw.owner.address=emid(999)
  raw.contents.value=EquipmentBaseItemBcs.serialize(item).toBytes();await expect(f.confirm()).rejects.toThrow()
})
it('does not accept a selected-instance listing owner for an unchecked instance',async()=>{
  const f=await fixture(),row=f.effects.V2.changedObjects.find(([id]:any[])=>id===emid(84))[1]
  row.outputState.ObjectWrite[1].AddressOwner=emid(901);f.refresh();await expect(f.confirm()).rejects.toThrow('remain with seller')
})
it('rejects a different historical binding even with all deletion IDs present',async()=>{
  const f=await fixture(),raw=f.history.get(f.key(f.bindingId,2n)),field=EquipmentBindingFieldBcs.parse(raw.contents.value)
  field.value.soul_id=emid(999);raw.contents.value=EquipmentBindingFieldBcs.serialize(field).toBytes()
  await expect(f.confirm()).rejects.toThrow('binding')
})
it('rejects altered historical selection commitments',async()=>{
  const f=await fixture(),raw=f.history.get(f.key(f.loadoutId,2n)),loadout=EquipmentLoadoutBcs.parse(raw.contents.value)
  loadout.commitment=Array(32).fill(33);raw.contents.value=EquipmentLoadoutBcs.serialize(loadout).toBytes()
  await expect(f.confirm()).rejects.toThrow('commitment')
})
it('accepts later holder rotation only as superseded, after historical seller retention is proven',async()=>{
  const f=await fixture(),raw=f.objects.get(emid(102)),item=EquipmentExternalItemBcs.parse(raw.contents.value)
  item.holder=emid(999);item.ownership_epoch='1';raw.contents.value=EquipmentExternalItemBcs.serialize(item).toBytes()
  raw.owner.address=item.holder;raw.version=4n;raw.digest=f.record.digest
  expect(await f.confirm()).toBe('SUPERSEDED')
})
it('rejects later holder rotation with no ownership epoch advance',async()=>{
  const f=await fixture(),raw=f.objects.get(emid(84)),item=EquipmentBaseItemBcs.parse(raw.contents.value)
  item.holder=emid(999);raw.contents.value=EquipmentBaseItemBcs.serialize(item).toBytes();raw.owner.address=item.holder;raw.version=4n
  await expect(f.confirm()).rejects.toThrow('epoch')
})
it.each(['missing','wrong epoch'])('requires retained Base ownership entitlement: %s',async problem=>{
  const f=await fixture()
  if(problem==='missing'){for(const [id,raw] of f.objects)if(raw.objectType?.includes('BaseItemHolderKeyV8'))f.objects.delete(id)}
  else f.field(emid(95),`${f.target.runtime!.originalPackageId}::runtime_v8::BaseItemHolderKeyV8`,EquipmentBaseHolderKeyBcs,
    {part_key:'body',item_key:'hat',holder:f.owner},`${f.target.runtime!.originalPackageId}::runtime_v8::BaseItemOwnershipRecordV8`,
    EquipmentBaseOwnershipBcs,{item_id:emid(84),ownership_epoch:'1'})
  await expect(f.confirm()).rejects.toThrow()
})
it.each([false,true])('proves canonical V1 deletion and retained/selected custody selected=%s',async selected=>{
  const f=await fixture(selected);f.useV1();expect(await f.confirm()).toBe('COMPLETE')
})
it.each(['missing-delete','duplicate-delete','tombstone','modified-version','shared-digest','missing-shared','prior-owner','output-owner'])(
  'rejects invalid V1 closure %s',async problem=>{
    const f=await fixture(),{v1,refreshV1}=f.useV1()
    if(problem==='missing-delete')v1.deleted.shift()
    if(problem==='duplicate-delete')v1.deleted.push(v1.deleted[0])
    if(problem==='tombstone')v1.deleted[0].digest=f.record.digest
    if(problem==='modified-version')v1.modifiedAtVersions[0][1]='1'
    if(problem==='shared-digest')v1.sharedObjects[0].digest=f.record.digest
    if(problem==='missing-shared')v1.sharedObjects=[]
    if(problem==='prior-owner')f.history.get(f.key(f.pointerId,2n)).owner.address=emid(999)
    if(problem==='output-owner')v1.mutated[0][1]={$kind:'AddressOwner',AddressOwner:emid(999)}
    refreshV1();await expect(f.confirm()).rejects.toThrow()
  })
