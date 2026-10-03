import {Inputs,Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {fromHex,toBase64} from '@mysten/sui/utils'
import {nativeEquipmentMarketAuthorityFixture} from './native-equipment-market-authority'
import {EquipmentBaseItemBcs,EquipmentExternalItemBcs} from '../../../web/lib/animacraft/native-equipment'
import {EquipmentMakerBcs} from '../../../web/lib/animacraft/native-equipment-source-bcs'
import {EquipmentMarketListingBcs} from '../../../web/lib/animacraft/native-equipment-market-bcs'
import {CompleteReadCatalogBcs} from '../../../web/lib/animacraft/native-complete-read-bcs'
import {readEquipmentMarketOperationSnapshot,type EquipmentMarketReadRequest} from '../../../web/lib/animacraft/equipment-market-operation-snapshot'
import {buildEquipmentMarketOperationTransaction,equipmentMarketInputRoles,equipmentOperationQuote,
  validateEquipmentMarketOperationRecord,type EquipmentMarketAction} from '../../../web/lib/animacraft/equipment-market-operation'
import type {EquipmentMarketOperationRecord} from '../../../web/lib/animacraft/equipment-market-operation-types'

export const emid=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
export async function equipmentMarketOperationFixture(options:{action?:EquipmentMarketAction;kind?:'base'|'external';equipped?:boolean}={}){
  const f=nativeEquipmentMarketAuthorityFixture(),action=options.action??'list',kind=options.kind??'base'
  if(kind==='external'||options.equipped)f.addExternal()
  if(options.equipped){
    f.set(emid(102),EquipmentExternalItemBcs,item=>{item.equip_lock={loadout_id:emid(80),equip_revision:'1',selection_index:'1'}})
    f.editLoadout(loadout=>{
      const first=loadout.selections[0]!
      loadout.selections=[first,{...first,selection_index:'1',part_key:'external-part',source_class:2,
        source_definition_id:emid(101),item_key:'external-hat',style_key:'blue',access_subject:emid(102),asset_content_commitment:Array(32).fill(5)}]
      loadout.definition_slots=[loadout.definition_slots[0],{...loadout.definition_slots[0],part_key:'external-part',start:'1'}]
      loadout.selection_count='2'
    })
  }
  const itemId=emid(kind==='base'?84:102),schema=kind==='base'?EquipmentBaseItemBcs:EquipmentExternalItemBcs
  if(!options.equipped)f.set(itemId,schema as typeof EquipmentBaseItemBcs,item=>{item.equip_lock=null})
  const target={...f.target,equipmentMarket:f.marketPin,marketWritesEnabled:true,equipmentWritesEnabled:true}
  const owner=emid(11),actor=action==='buy'?emid(900):owner,listingId=emid(800),priceAtomic='10001'
  const scope=options.equipped?{soulId:emid(12),stateId:emid(14)}:undefined
  const owned=await readEquipmentMarketOperationSnapshot(f.client,target,{rootId:f.rootId,itemId,kind,actor:owner,equipmentScope:scope})
  if(action!=='list'){
    const root=EquipmentMakerBcs.parse(f.objects.get(f.rootId).contents.value)
    const catalog=CompleteReadCatalogBcs.parse(f.objects.get(f.ids.catalog).contents.value)
    const q=equipmentOperationQuote(owned,priceAtomic)
    f.put(listingId,`${f.mt('EquipmentListingV8')}<${f.coin}>`,EquipmentMarketListingBcs,{
      id:listingId,version:'8',registry_id:f.ids.registry,treasury_id:f.ids.treasury,package_config_id:f.ids.config,
      root_id:f.rootId,maker_version:root.maker_version,root_content_commitment:root.content.content_commitment,
      custody:{version:'8',catalog_id:catalog.id,product_binding_commitment:catalog.binding.commitment,
        call_cap_set_commitment:catalog.call_cap_set_commitment,market_authority_id:catalog.authority_ids[4],
        market_registry_id:f.ids.registry,market_treasury_id:f.ids.treasury,listing_id:listingId,
        root_id:f.rootId,maker_version:root.maker_version,root_content_commitment:root.content.content_commitment,
        asset_id:itemId,asset_kind:kind==='base'?0:2,source_id:kind==='base'?emid(85):emid(101),
        asset_commitment:[...fromHex(owned.assetCommitment)],holder:owner,ownership_epoch:'0'},
      gross_atomic:q.grossAtomic,protocol_atomic:q.protocolAtomic,seller_atomic:q.sellerAtomic,creator_atomic:'0',source_atomic:'0',
      quote_commitment:[...fromHex(q.commitment)],status:0,revision:'7',terminal_recipient:emid(0)})
    f.objects.get(itemId).owner={kind:1,address:listingId}
    if(action==='recover')f.set(f.rootId,EquipmentMakerBcs,root=>{root.lifecycle=2})
  }
  const request:EquipmentMarketReadRequest={rootId:f.rootId,itemId,kind,actor,...(action==='list'?{equipmentScope:scope}:{listingId})}
  const snapshot=action==='list'?owned:await readEquipmentMarketOperationSnapshot(f.client,target,request)
  const draft={schema:1 as const,kind:'equipment-market' as const,action,snapshot,
    priceAtomic:action==='reprice'?'20001':priceAtomic,paymentCoins:action==='buy'
      ?[{objectId:emid(901),version:'2',digest:f.target.outputCallableDigest,balanceAtomic:'20000'}]:[]}
  const expected=buildEquipmentMarketOperationTransaction(draft),roles=equipmentMarketInputRoles(draft),data=expected.getData()
  data.inputs=data.inputs.map(input=>{
    if(!input.UnresolvedObject)return input
    const objectId=input.UnresolvedObject.objectId
    const ref=objectId===itemId?snapshot.reference:draft.paymentCoins.find(c=>c.objectId===objectId)
    return roles.owned.has(objectId)?Inputs.ObjectRef({objectId,version:ref?.version??'2',digest:ref?.digest??f.target.outputCallableDigest})
      :Inputs.SharedObjectRef({objectId,initialSharedVersion:'1',mutable:roles.mutable.has(objectId)})
  })
  const tx=Transaction.from(JSON.stringify(data))
  tx.setSender(actor);tx.setGasOwner(actor);tx.setGasPrice(1);tx.setGasBudget(100000)
  tx.setGasPayment([{objectId:emid(902),version:'2',digest:f.target.outputCallableDigest}]);tx.setExpiration({Epoch:9})
  const bytes=await tx.build()
  const record=validateEquipmentMarketOperationRecord({...draft,bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes),
    expirationEpoch:'9',phase:'PREPARED',signature:null})
  return {...f,target,itemId,actor,owner,listingId,kind,action,snapshot,record,tx,bytes,request,
    read:()=>readEquipmentMarketOperationSnapshot(f.client,target,request)}
}

export async function equipmentRecordWithTransaction(record:EquipmentMarketOperationRecord,tx:Transaction){
  const bytes=await tx.build()
  return {...structuredClone(record),bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes)}
}
