import {vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {fromHex,toBase58} from '@mysten/sui/utils'
import {equipmentMarketEvidenceFixture} from './equipment-market-evidence'
import {confirmBrowserEquipmentMarketOperation} from '../../../web/lib/animacraft/browser-equipment-market-readback'
import {equipmentOperationQuote,type EquipmentMarketAction} from '../../../web/lib/animacraft/equipment-market-operation'
import {EquipmentBaseItemBcs,EquipmentExternalItemBcs,EquipmentLoadoutBcs} from '../../../web/lib/animacraft/native-equipment'
import {EquipmentBaseHolderKeyBcs,EquipmentBaseOwnershipBcs} from '../../../web/lib/animacraft/native-equipment-source-bcs'
import {EquipmentMarketListingBcs} from '../../../web/lib/animacraft/native-equipment-market-bcs'
import {CompleteReadCatalogBcs} from '../../../web/lib/animacraft/native-complete-read-bcs'
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
export async function equipmentMarketReadbackFixture(action:EquipmentMarketAction='list',kind:'base'|'external'='base',equipped=false){
  const f=await equipmentMarketEvidenceFixture(action,kind,equipped),r=f.record,s=r.snapshot,objects=f.objects
  r.phase='SUCCEEDED';r.syncStatus='PENDING'
  for(const row of objects.values())if(row.owner?.kind===3)row.owner.version=1n
  for(const pkg of f.packages)objects.get(pkg.objectId).package.typeOrigins.push(...pkg.package.typeOrigins)
  const catalog=CompleteReadCatalogBcs.parse(objects.get(f.ids.catalog).contents.value),q=equipmentOperationQuote(s,r.priceAtomic)
  const post:any=action==='list'?{
    id:f.listingId,version:'8',registry_id:s.target.registryId,treasury_id:s.target.treasuryId,package_config_id:s.target.packageConfigId,
    root_id:s.target.rootId,maker_version:s.quoteContext.makerVersion,root_content_commitment:[...fromHex(s.quoteContext.rootContentCommitment)],
    custody:{version:'8',catalog_id:catalog.id,product_binding_commitment:catalog.binding.commitment,call_cap_set_commitment:catalog.call_cap_set_commitment,
      market_authority_id:catalog.authority_ids[4],market_registry_id:s.target.registryId,market_treasury_id:s.target.treasuryId,listing_id:f.listingId,
      root_id:s.target.rootId,maker_version:s.quoteContext.makerVersion,root_content_commitment:[...fromHex(s.quoteContext.rootContentCommitment)],
      asset_id:s.asset.itemId,asset_kind:kind==='base'?0:2,source_id:s.asset.kind==='base'?s.asset.baseRegistryId:s.asset.productId,
      asset_commitment:[...fromHex(s.assetCommitment)],holder:s.seller,ownership_epoch:s.ownershipEpoch},
  }:EquipmentMarketListingBcs.parse(objects.get(f.listingId).contents.value)
  const status=action==='buy'?1:action==='cancel'?2:action==='recover'?3:0,recipient=action==='buy'?s.actor:s.seller
  Object.assign(post,{gross_atomic:r.priceAtomic,protocol_atomic:q.protocolAtomic,creator_atomic:'0',source_atomic:'0',seller_atomic:q.sellerAtomic,
    quote_commitment:[...fromHex(q.commitment)],status,revision:action==='list'?'0':String(BigInt(s.listing!.revision)+1n),
    terminal_recipient:status===0?id(0):recipient})
  const digest=(n:number)=>toBase58(new Uint8Array(32).fill(n))
  const history=new Map<string,any>(),historyKey=(objectId:string,version:bigint)=>`${objectId}:${version}`
  const predecessor=structuredClone(objects.get(s.asset.itemId))
  history.set(historyKey(s.asset.itemId,BigInt(s.reference.version)),predecessor)
  const birth=action==='list'?3n:1n
  const listing={objectId:f.listingId,objectType:`${f.mt('EquipmentListingV8')}<${f.coin}>`,version:3n,digest:digest(11),
    owner:{kind:3,version:birth},previousTransaction:r.digest,contents:{value:EquipmentMarketListingBcs.serialize(post).toBytes()}}
  const item=structuredClone(objects.get(s.asset.itemId)),schema=kind==='base'?EquipmentBaseItemBcs:EquipmentExternalItemBcs
  const value:any=schema.parse(item.contents.value)
  value.equip_lock=null;value.holder=recipient;value.ownership_epoch=action==='buy'?String(BigInt(s.ownershipEpoch)+1n):s.ownershipEpoch
  item.contents.value=schema.serialize(value).toBytes();item.owner={kind:1,address:status===0?f.listingId:recipient}
  if(action!=='reprice'){item.version=3n;item.digest=digest(12);item.previousTransaction=r.digest}
  objects.set(f.listingId,listing);objects.set(s.asset.itemId,item)
  history.set(historyKey(f.listingId,3n),structuredClone(listing));history.set(historyKey(s.asset.itemId,item.version),structuredClone(item))
  function moveEntitlement(holder:string,epoch:string){
    if(kind!=='base')return
    for(const [key,row] of objects)if(row.objectType?.includes('BaseItemHolderKeyV8'))objects.delete(key)
    f.field(id(95),`${s.release.runtime!.originalPackageId}::runtime_v8::BaseItemHolderKeyV8`,EquipmentBaseHolderKeyBcs,
      {part_key:'body',item_key:'hat',holder},`${s.release.runtime!.originalPackageId}::runtime_v8::BaseItemOwnershipRecordV8`,
      EquipmentBaseOwnershipBcs,{item_id:s.asset.itemId,ownership_epoch:epoch})
  }
  moveEntitlement(recipient,value.ownership_epoch)
  const shared={Shared:{initialSharedVersion:String(birth)}}
  f.effects.V2.changedObjects=[
    [f.listingId,{inputState:action==='list'?{NotExist:true}:{Exist:[['2',s.reference.digest],shared]},
      outputState:{ObjectWrite:[listing.digest,shared]},idOperation:action==='list'?{Created:true}:{None:true}}],
    ...(action==='reprice'?[]:[[s.asset.itemId,{inputState:{Exist:[[s.reference.version,s.reference.digest],{AddressOwner:action==='list'?s.actor:s.listing!.id}]},
      outputState:{ObjectWrite:[item.digest,{AddressOwner:item.owner.address}]},idOperation:{None:true}}]]),
  ]
  if(s.removal?.equipment){
    const final=s.removal.equipment,loadoutId=final.plan.scope.equipmentId,raw=objects.get(loadoutId)
    const previous=structuredClone(raw),loadout=EquipmentLoadoutBcs.parse(raw.contents.value)
    loadout.revision=final.finalRevision;loadout.selection_count=final.finalSelectionCount;loadout.commitment=[...fromHex(final.finalCommitment)]
    loadout.selections=loadout.selections.map((slot,index)=>final.retainedSelectionIndexes.includes(String(index))?slot:null)
    raw.version=3n;raw.digest=digest(17);raw.previousTransaction=r.digest;raw.contents.value=EquipmentLoadoutBcs.serialize(loadout).toBytes()
    history.set(historyKey(loadoutId,3n),structuredClone(raw))
    const owner={Shared:{initialSharedVersion:String(raw.owner.version)}}
    f.effects.V2.changedObjects.push([loadoutId,{inputState:{Exist:[[String(previous.version),previous.digest],owner]},
      outputState:{ObjectWrite:[raw.digest,owner]},idOperation:{None:true}}])
  }
  f.refresh()
  const get=vi.fn(async(p:any)=>({response:{object:p.version===undefined?objects.get(p.objectId):history.get(historyKey(p.objectId,p.version))}}))
  const batch=vi.fn(async({requests}:any)=>({response:{objects:requests.map((p:any)=>{
    const object=p.version===undefined?objects.get(p.objectId):history.get(historyKey(p.objectId,p.version))
    return {result:object?{oneofKind:'object',object}:{oneofKind:'error',error:{code:5}}}
  })}}))
  const client:any={...f.rawClient,ledgerService:{...f.rawClient.ledgerService,...f.client.ledgerService,getObject:get,batchGetObjects:batch}}
  const edit=(objectId:string,codec:any,change:(v:any)=>void,historical=false)=>{
    const raw=historical?history.get(historyKey(objectId,objectId===s.asset.itemId&&action==='reprice'?2n:3n)):objects.get(objectId)
    const v=codec.parse(raw.contents.value);change(v);raw.contents.value=codec.serialize(v).toBytes()
  }
  function laterHolder(holder:string,epoch:string){
    edit(s.asset.itemId,schema,v=>{v.holder=holder;v.ownership_epoch=epoch})
    const raw=objects.get(s.asset.itemId);raw.version=4n;raw.digest=digest(13);raw.previousTransaction=digest(14);raw.owner={kind:1,address:holder}
    moveEntitlement(holder,epoch)
  }
  function laterListing(change:(v:any)=>void){
    edit(f.listingId,EquipmentMarketListingBcs,change);const raw=objects.get(f.listingId)
    raw.version=4n;raw.digest=digest(15);raw.previousTransaction=digest(14)
  }
  function useV1Effects(){
    const v2=bcs.TransactionEffects.parse(f.ledger.effects.bcs.value).V2
    if(!v2)throw new Error('V1 conversion requires serialized V2 fixture effects')
    type V1=NonNullable<ReturnType<typeof bcs.TransactionEffects.parse>['V1']>
    const gas=r.snapshot.actor,gasInput=f.tx.getData().gasData.payment![0]
    const v1:V1={status:v2.status,executedEpoch:v2.executedEpoch,gasUsed:v2.gasUsed,
      modifiedAtVersions:[],sharedObjects:[],transactionDigest:v2.transactionDigest,
      created:[],mutated:[],unwrapped:[],deleted:[],unwrappedThenDeleted:[],wrapped:[],
      gasObject:[{objectId:gasInput.objectId,version:v2.lamportVersion,digest:digest(19)},{$kind:'AddressOwner',AddressOwner:gas}],
      eventsDigest:v2.eventsDigest,dependencies:v2.dependencies}
    for(const [objectId,change] of v2.changedObjects){
      const output=change.outputState.ObjectWrite,input=change.inputState.Exist
      if(!output)throw new Error('V1 fixture conversion expects an object write')
      const ref={objectId,version:v2.lamportVersion,digest:output[0]}
      if(change.idOperation.$kind==='Created')v1.created.push([ref,output[1]])
      else if(change.idOperation.$kind==='None'&&input){
        v1.mutated.push([ref,output[1]]);v1.modifiedAtVersions.push([objectId,input[0][0]])
        if(input[1].$kind==='Shared')v1.sharedObjects.push({objectId,version:input[0][0],digest:input[0][1]})
      }else throw new Error('V1 fixture conversion does not support this ID operation')
    }
    const refreshV1=()=>{f.ledger.effects.bcs.value=bcs.TransactionEffects.serialize({V1:v1}).toBytes()}
    refreshV1();return {v1,refreshV1}
  }
  return {...f,client,history,historyKey,listing,item,get,batch,digest,edit,laterHolder,laterListing,moveEntitlement,useV1Effects,
    confirm:()=>confirmBrowserEquipmentMarketOperation(r,{}, {client})}
}
