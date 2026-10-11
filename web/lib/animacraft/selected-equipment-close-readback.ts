import {bcs} from '@mysten/sui/bcs'
import {Transaction} from '@mysten/sui/transactions'
import {deriveDynamicFieldID,fromBase58,fromBase64,toHex} from '@mysten/sui/utils'
import {decodeNativeBcs,receiveId,type NativeReceiveTarget} from './native-receive'
import {EquipmentReadSet,EquipmentLoadoutBcs,EquipmentKeyBcs,EquipmentBindingFieldBcs,EquipmentPointerBcs,
  EquipmentBaseItemBcs,EquipmentExternalItemBcs,equipmentCommitment,readNativeEquipment} from './native-equipment'
import {readEquipmentMarketCustodySnapshot} from './native-equipment-market-read'
import type {SelectedSaleEquipmentPreparation} from './native-selected-equipment-sale'
import type {EquipmentMarketReadbackContext} from './browser-equipment-market-readback'
import {marketListCheck as check,marketListCanonical as canonical} from './market-list-operation'

type Effects=ReturnType<typeof bcs.TransactionEffects.parse>
const LayoutFieldBcs=bcs.struct('Field',{id:bcs.Address,name:EquipmentKeyBcs,value:bcs.bool()})
const hex=(v:number[])=>toHex(Uint8Array.from(v))
const fingerprint=(v:unknown)=>JSON.stringify(v,(_k,value)=>typeof value==='bigint'?String(value):value)

/** Historical closure is a deletion, NOT a shared loadout output. Call only
 * after validating the complete saved PTB and authenticated ordered sale receipts;
 * the caller must also verify each selected listing and the final read session. */
export async function confirmAuthenticatedClosedEquipmentGroup(value:{actor:string;ownershipEpoch:string;rootId:string;
  target:NativeReceiveTarget;preparation:SelectedSaleEquipmentPreparation;bytes:string;digest:string;effects:Effects;
  selectedListings:ReadonlyMap<string,string>},context:EquipmentMarketReadbackContext):Promise<'COMPLETE'|'SUPERSEDED'>{
  const {actor,ownershipEpoch,rootId,target,preparation,bytes,digest,effects,selectedListings}=value
  const {client,signal,reads}=context,e=preparation.equipment
  check(e&&e.closeBinding&&preparation.sellSoul,'Closed equipment group required')
  const plan=e.plan,id=plan.scope.equipmentId,inputs=Transaction.from(fromBase64(bytes)).getData().inputs
  const shared=inputs.find(i=>i.Object?.SharedObject?.objectId===id)?.Object?.SharedObject
  check(shared?.mutable,'Closed equipment shared input missing')
  const runtime=(await client.ledgerService.getObject({objectId:target.runtime!.callablePackageId})).response.object!
  check(runtime.owner?.kind===4&&runtime.digest===target.runtime!.callableDigest&&runtime.package?.storageId===target.runtime!.callablePackageId
    &&runtime.package.originalId===target.runtime!.originalPackageId&&runtime.package.version===runtime.version,'Closed equipment Runtime pin mismatch')
  const type=(name:string)=>{
    const origins=runtime.package!.typeOrigins.filter(row=>row.moduleName==='runtime_v8'&&row.datatypeName===name)
    check(origins.length===1,'Closed equipment type origin missing')
    return `${receiveId(origins[0].packageId)}::runtime_v8::${name}`
  }
  const predecessor=async(objectId:string,objectType:string,kind:1|2|3,parent:string,deleted:boolean)=>{
    let version:bigint,committedDigest:string|undefined,finalVersion:bigint
    if(effects.V2){
      const rows=effects.V2.changedObjects.filter(([key])=>key===objectId)
      check(rows.length===1,'Closed equipment effect missing or duplicated')
      const change=rows[0][1],before=change.inputState.Exist
      check(before&&change.idOperation.$kind===(deleted?'Deleted':'None')
        &&(deleted?change.outputState.$kind==='NotExist':Boolean(change.outputState.ObjectWrite)),
      'Closed equipment deletion/mutation mismatch')
      check(kind===3?before[1].Shared?.initialSharedVersion===parent:
        kind===2?before[1].ObjectOwner===parent:before[1].AddressOwner===parent,'Closed equipment input owner mismatch')
      version=BigInt(before[0][0]);committedDigest=before[0][1];finalVersion=BigInt(effects.V2.lamportVersion)
    }else{
      check(effects.V1,'Closed equipment effects unavailable')
      const rows=(deleted?effects.V1.deleted:effects.V1.mutated.map(([ref])=>ref)).filter(row=>row.objectId===objectId)
      const versions=effects.V1.modifiedAtVersions.filter(([key])=>key===objectId)
      check(rows.length===1&&versions.length===1&&(!deleted||fromBase58(rows[0].digest).every(v=>v===99)),
        'Closed equipment V1 deletion/mutation missing')
      version=BigInt(versions[0][1]);finalVersion=BigInt(rows[0].version)
      if(kind===3){
        const sharedRows=effects.V1.sharedObjects.filter(row=>row.objectId===objectId)
        check(sharedRows.length===1&&sharedRows[0].version===String(version),'Closed equipment V1 shared input missing')
        committedDigest=sharedRows[0].digest
      }
    }
    check(version>0n&&finalVersion>version,'Closed equipment input/output version mismatch')
    const raw=(await client.ledgerService.getObject({objectId,version})).response.object!
    check(raw.digest===(committedDigest??raw.digest)&&(kind!==3||String(raw.owner?.version)===parent),'Closed equipment predecessor reference mismatch')
    const owned=inputs.find(i=>i.Object?.ImmOrOwnedObject?.objectId===objectId)?.Object?.ImmOrOwnedObject
    if(kind===1)check(owned&&owned.version===String(version)&&owned.digest===raw.digest,'Closed equipment owned input differs from saved bytes')
    const data=new EquipmentReadSet(client).accept(raw,objectId,objectType,kind,kind===3?undefined:parent)
    return {raw,data,finalVersion}
  }
  const before=await predecessor(id,type('MakerLoadoutV8'),3,String(shared.initialSharedVersion),true)
  const loadout=decodeNativeBcs(EquipmentLoadoutBcs,before.data)
  check(loadout.id===id&&loadout.version==='8'&&loadout.holder===actor&&loadout.root_id===rootId
    &&loadout.definition_registry_id===plan.definitionRegistryId&&loadout.revision===String(plan.scope.expectedRevision)
    &&equipmentCommitment(loadout)===hex(loadout.commitment),'Closed equipment predecessor identity/commitment mismatch')
  const expected=loadout.selections.flatMap((selection,index)=>{
    if(!selection)return []
    check(selection.selection_index===String(index)&&[0,1,2].includes(selection.source_class),'Closed equipment selection mismatch')
    return [selection.source_class===1||selection.source_class===0&&selection.access_subject===loadout.maker_access_pass_id
      ?{kind:'selection',selectionIndex:String(index)}:{kind:selection.source_class===0?'base':'external',itemId:selection.access_subject}]
  })
  check(canonical(expected)===canonical(plan.removals)&&String(expected.length)===loadout.selection_count
    &&e.finalRevision===String(BigInt(loadout.revision)+BigInt(expected.length))&&e.finalSelectionCount==='0'
    &&e.retainedSelectionIndexes.length===0&&e.finalCommitment===equipmentCommitment({...loadout,selections:loadout.selections.map(()=>null)}),
  'Closed equipment final plan differs from historical selections')
  const pointerId=deriveDynamicFieldID(preparation.stateId,'u8',new Uint8Array([10]))
  const pointer=decodeNativeBcs(EquipmentPointerBcs,(await predecessor(pointerId,'0x2::dynamic_field::Field<u8,0x2::object::ID>',2,preparation.stateId,true)).data)
  check(pointer.id===pointerId&&pointer.name===10&&pointer.value===id,'Closed equipment DF10 mismatch')
  const keyType=type('SoulEquipmentKeyV8'),bindingType=type('SoulEquipmentBindingV8')
  const bindingId=deriveDynamicFieldID(id,keyType,EquipmentKeyBcs.serialize({dummy_field:false}).toBytes())
  const field=decodeNativeBcs(EquipmentBindingFieldBcs,(await predecessor(bindingId,`0x2::dynamic_field::Field<${keyType},${bindingType}>`,2,id,true)).data)
  check(field.id===bindingId&&!field.name.dummy_field&&field.value.soul_id===preparation.soulId&&field.value.soul_state_id===preparation.stateId
    &&field.value.holder===actor&&field.value.ownership_epoch===ownershipEpoch&&field.value.protocol_config_id===target.protocolConfigId,
  'Closed equipment historical binding mismatch')
  const layoutType=type('SoulEquipmentLayoutKeyV8'),layoutId=deriveDynamicFieldID(id,layoutType,EquipmentKeyBcs.serialize({dummy_field:false}).toBytes())
  const layout=decodeNativeBcs(LayoutFieldBcs,(await predecessor(layoutId,`0x2::dynamic_field::Field<${layoutType},bool>`,2,id,true)).data)
  check(layout.id===layoutId&&!layout.name.dummy_field&&layout.value,'Closed equipment layout mismatch')
  let superseded=false
  for(const removal of plan.removals){
    if(removal.kind==='selection')continue
    const selected=preparation.selectedItems.find(row=>row.itemId===removal.itemId)
    check(!selected||selectedListings.has(removal.itemId),'Selected removed instance listing missing')
    const listingId=selected?selectedListings.get(removal.itemId)!:null,owner=listingId??actor
    const itemType=type(removal.kind==='base'?'OwnedBaseItemV8':'OwnedExternalItemV8')
    const prior=await predecessor(removal.itemId,itemType,1,actor,false)
    const item=removal.kind==='base'?decodeNativeBcs(EquipmentBaseItemBcs,prior.data):decodeNativeBcs(EquipmentExternalItemBcs,prior.data)
    const selection=loadout.selections.find(row=>row?.access_subject===removal.itemId)
    check(selection&&item.id===removal.itemId&&item.version==='8'&&item.holder===actor&&item.ownership_epoch===selection.source_epoch
      &&item.equip_lock?.loadout_id===id&&item.equip_lock.selection_index===selection.selection_index
      &&BigInt(item.equip_lock.equip_revision)>0n&&BigInt(item.equip_lock.equip_revision)<=BigInt(loadout.revision),
    'Closed equipment instance predecessor lock mismatch')
    if('root_id'in item)check(item.root_id===loadout.root_id&&item.root_version===loadout.root_version
      &&hex(item.root_content_commitment)===hex(loadout.root_content_commitment)&&item.definition_registry_id===loadout.definition_registry_id
      &&item.pack_registry_id===loadout.pack_registry_id&&selection.source_definition_id===item.root_id
      &&selection.part_key===item.part_key&&selection.item_key===item.item_key,'Closed equipment Base source mismatch')
    else check(item.product_id===selection.source_definition_id&&hex(item.asset_content_commitment)===hex(selection.asset_content_commitment),
      'Closed equipment External source mismatch')
    check(!selected||selected.kind===removal.kind&&selected.ownershipEpoch===item.ownership_epoch&&selected.selectionIndex===selection.selection_index,
      'Closed equipment selected-instance scope mismatch')
    let outputDigest:string
    if(effects.V2){
      const output=effects.V2.changedObjects.find(([key])=>key===removal.itemId)![1].outputState.ObjectWrite!
      check(output[1].AddressOwner===owner,'Unchecked equipment did not remain with seller');outputDigest=output[0]
    }else{
      const output=effects.V1!.mutated.find(([ref])=>ref.objectId===removal.itemId)!
      check(output[1].AddressOwner===owner,'Unchecked V1 equipment did not remain with seller');outputDigest=output[0].digest
    }
    const raw=(await client.ledgerService.getObject({objectId:removal.itemId,version:prior.finalVersion})).response.object!
    check(raw.digest===outputDigest&&raw.previousTransaction===digest,'Removed equipment output reference mismatch')
    const data=new EquipmentReadSet(client).accept(raw,removal.itemId,itemType,1,owner)
    const post=removal.kind==='base'?decodeNativeBcs(EquipmentBaseItemBcs,data):decodeNativeBcs(EquipmentExternalItemBcs,data)
    check(canonical(post)===canonical({...item,equip_lock:null}),'Removed equipment contents/holder changed')
    if(selected)continue // The caller verifies selected listing and current custody.
    const current=(await client.ledgerService.getObject({objectId:removal.itemId})).response.object!
    check(current.version!>=prior.finalVersion&&(current.version!==prior.finalVersion||fingerprint(current)===fingerprint(raw)),
      'Retained equipment reference regressed')
    const liveData=reads.accept(current,removal.itemId,itemType,1,receiveId(current.owner?.address))
    const live=removal.kind==='base'?decodeNativeBcs(EquipmentBaseItemBcs,liveData):decodeNativeBcs(EquipmentExternalItemBcs,liveData)
    check(canonical({...live,holder:item.holder,ownership_epoch:item.ownership_epoch,equip_lock:null})===canonical(post)
      &&BigInt(live.ownership_epoch)>=BigInt(item.ownership_epoch)
      &&(live.holder===item.holder||BigInt(live.ownership_epoch)>BigInt(item.ownership_epoch)),'Retained equipment later identity/epoch mismatch')
    const changed=canonical(live)!==canonical(post)||current.owner?.address!==actor
    // Address-owner equality alone is not the complete ownership proof: Base
    // entitlement records and External source identity must also remain valid.
    check(target.equipmentMarket,'Retained equipment custody authority unavailable')
    await readEquipmentMarketCustodySnapshot(client,target,target.equipmentMarket,
      {rootId,itemId:removal.itemId,kind:removal.kind},signal,reads)
    superseded ||= changed
  }
  const currentPointer=await reads.pointer(preparation.stateId)
  if(currentPointer!==null){
    check(currentPointer!==id,'Deleted equipment binding reappeared')
    await readNativeEquipment(client,target,{soulId:preparation.soulId,stateId:preparation.stateId},reads)
    superseded=true
  }
  signal.throwIfAborted();return superseded?'SUPERSEDED':'COMPLETE'
}
