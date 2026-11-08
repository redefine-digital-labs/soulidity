import {bcs,TypeTagSerializer} from '@mysten/sui/bcs'
import {fromBase58,fromHex,deriveDynamicFieldID,toBase64,normalizeStructTag} from '@mysten/sui/utils'
import {deriveKioskItemFieldId,KioskItemFieldBcs,KIOSK_ITEM_FIELD_TYPE,SoulPublicKioskBcs} from '@soulidity/sdk'
import {commerceSaleMoneyFixture} from './commerce-sale-money'
import {activityEvidenceFixture,activityHash,aid,adigest} from './activity-transaction-evidence'
import vm from './native-creation-lifecycle-vm.json'
import {CanonicalOwnedAccountBcs,CanonicalSoulBcs} from '../../../web/lib/soulidity/canonical-native-workbench'
import {NativeSoldBcs} from '../../../web/lib/soulidity/commerce/native-sale-receipt'
import {NativeSalePaidBcs} from '../../../web/lib/soulidity/commerce/native-sale-history'
import {SaleCollectionBcs,saleCollectionSnapshotHash} from '../../../web/lib/soulidity/commerce/collection-sale-proof'

// One original SDK packet/effects/events/checkpoint containing both actual
// money/listing exit and full custody evidence. Controlled objects, no node run.
export async function purchaseRecoveryCustodyFixture(variant=''){
 const standard=await activityEvidenceFixture(),custody=await activityEvidenceFixture()
 const pin=(p:any)=>({originalPackageId:p.originalPackageId,callablePackageId:p.callablePackageId,callableDigest:p.callableDigest})
 function pkg(f:typeof standard,original:number,callable:number,module:string,name:string){const p=f.packageData.data.Package!;f.deployment.originalPackageId=aid(original);f.deployment.callablePackageId=aid(callable);p.id=aid(callable);p.moduleMap=new Map([[module,new Uint8Array([1])]]);p.typeOriginTable=[{moduleName:module,datatypeName:name,package:aid(original)}];f.rehashPackage()}
 pkg(standard,144,145,'soul','Soul');pkg(custody,146,147,'account','Account')
 const accountId=aid(67),buyer=aid(7),buyerKiosk=aid(65),accountType=`${aid(146)}::account::Account`
 const authority={cap:{id:aid(149),for:buyerKiosk},owner:buyer,kiosk:buyerKiosk,closed_digest:fromBase58(adigest(9))},account={id:accountId,owner:buyer,kiosk:buyerKiosk,authority}
 const accountBytes=CanonicalOwnedAccountBcs.serialize(account).toBytes(),rawAccount=bcs.Object.serialize({data:{Move:{type:{Other:TypeTagSerializer.parseFromStr(accountType).struct!},hasPublicTransfer:true,version:9,contents:accountBytes}},owner:{AddressOwner:buyer},previousTransaction:adigest(9),storageRebate:0}).toBytes()
 const x=await commerceSaleMoneyFixture(variant==='collection'?'collection':'',{objectId:accountId,version:'9',digest:variant==='account-reference'?adigest(999):activityHash('Object',rawAccount)}),p=x.params,f=x.f,plan=p.plan
 const np=f.packageData.data.Package!;np.linkageTable.set(aid(144),{upgradedId:aid(145),upgradedVersion:'2'});np.linkageTable.set(aid(146),{upgradedId:aid(147),upgradedVersion:'2'});f.rehashPackage()
 const rows=new Map<string,any>(),object=(...args:Parameters<typeof x.object>)=>{const result=x.object(...args);if(args[3].Shared)result.row.owner.version=BigInt(args[3].Shared.initialSharedVersion);rows.set(`${args[0]}:${args[4]}`,result.row);return result},effect=x.effect
 const root=CanonicalSoulBcs.parse(fromHex(vm.rows.NEW.rootAfterReopenHex));root.id=plan.soulId;root.revision='1'
 const oldItem=deriveKioskItemFieldId(plan.sellerKioskId,root.id),newItem=deriveKioskItemFieldId(plan.buyerKioskId,root.id),rootType=`${aid(144)}::soul::Soul`
 const rootBefore=object(root.id,rootType,CanonicalSoulBcs.serialize(root).toBytes(),{ObjectOwner:oldItem},9);root.revision='2'
 effect(root.id,rootBefore,object(root.id,rootType,CanonicalSoulBcs.serialize(root).toBytes(),{ObjectOwner:variant==='root-owner'?oldItem:newItem},10))
 const item=(id:string)=>KioskItemFieldBcs.serialize({id,name:{name:{id:root.id}},value:root.id}).toBytes()
 effect(oldItem,object(oldItem,KIOSK_ITEM_FIELD_TYPE,item(oldItem),{ObjectOwner:plan.sellerKioskId},9),null)
 effect(newItem,null,object(newItem,KIOSK_ITEM_FIELD_TYPE,item(newItem),{ObjectOwner:plan.buyerKioskId},10))
 const Lock=bcs.struct('Lock',{id:bcs.Address,name:bcs.struct('Key',{id:bcs.Address}),value:bcs.bool()}),lockType='0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>'
 const sellerLock=deriveDynamicFieldID(plan.sellerKioskId,'0x2::kiosk::Lock',bcs.Address.serialize(root.id).toBytes()),buyerLock=deriveDynamicFieldID(plan.buyerKioskId,'0x2::kiosk::Lock',bcs.Address.serialize(root.id).toBytes())
 effect(sellerLock,object(sellerLock,lockType,Lock.serialize({id:sellerLock,name:{id:root.id},value:true}).toBytes(),{ObjectOwner:plan.sellerKioskId},9),null)
 effect(buyerLock,null,object(buyerLock,lockType,Lock.serialize({id:buyerLock,name:{id:root.id},value:variant!=='buyer-lock'}).toBytes(),{ObjectOwner:plan.buyerKioskId},10))
 for(const [id,owner,count,delta] of [[plan.sellerKioskId,x.offer.seller,1,-1],[plan.buyerKioskId,buyer,0,1]] as const){const value={id,owner,profits:0,item_count:count,allow_extensions:false},shared={Shared:{initialSharedVersion:variant==='kiosk-reference'?2:1}}
  effect(id,object(id,'0x2::kiosk::Kiosk',SoulPublicKioskBcs.serialize(value).toBytes(),shared,9),object(id,'0x2::kiosk::Kiosk',SoulPublicKioskBcs.serialize({...value,item_count:count+delta}).toBytes(),shared,10))}
 effect(accountId,object(accountId,accountType,accountBytes,{AddressOwner:buyer},9),object(accountId,accountType,CanonicalOwnedAccountBcs.serialize({...account,authority:{...authority,closed_digest:fromBase58(variant==='account-closure'?adigest(999):f.ledger.digest)}}).toBytes(),{AddressOwner:buyer},10))
 if(variant==='missing-lock')rows.delete(`${buyerLock}:10`)
 const prior=p.client.ledgerService.getObject.getMockImplementation()!
 p.client.ledgerService.getObject.mockImplementation(async(r:any)=>{if(r.version===undefined){if(r.objectId===aid(145))return {response:{object:standard.pkg}};if(r.objectId===aid(147))return {response:{object:custody.pkg}}}if(rows.has(`${r.objectId}:${r.version}`))return {response:{object:rows.get(`${r.objectId}:${r.version}`)}};if(variant==='missing-lock'&&r.objectId===buyerLock)return {response:{}};return prior(r)})
 const collectionObject=plan.collectionId?(await p.client.ledgerService.getObject({objectId:plan.collectionId,version:9n})).response.object:null
 const collectionSnapshot=collectionObject?Array.from(saleCollectionSnapshotHash(SaleCollectionBcs.parse(collectionObject.contents.value))):null
 const sale={offer:plan.offerId,root:plan.soulId,seller:x.offer.seller,buyer,seller_kiosk:plan.sellerKioskId,buyer_kiosk:plan.buyerKioskId,ask:String(x.quote.ask),platform:String(x.quote.platform),creator:String(x.quote.creator),collection:plan.collectionId,collection_amount:String(x.quote.collection),collection_holder:plan.collectionId?x.collectionHolder:x.offer.seller,collection_snapshot:collectionSnapshot,total:String(x.quote.total),old_generation:'0',attempt:Array.from(new Uint8Array(32).fill(1))}
 f.effectsData.V2!.changedObjects=x.changes
 f.eventsData.data=[{package_id:p.native.callablePackageId,transaction_module:'market',sender:buyer,type_:{address:p.native.originalPackageId,module:'market',name:'Sold',typeParams:[]},contents:NativeSoldBcs.serialize(sale).toBytes()},
  {package_id:p.foundation.callablePackageId,transaction_module:'economics',sender:buyer,type_:{address:p.foundation.originalPackageId,module:'economics',name:'Paid',typeParams:[]},contents:NativeSalePaidBcs.serialize({subject:plan.soulId,payer:buyer,beneficiary:x.offer.seller,gross:sale.total,fee:sale.platform,attempt:sale.attempt}).toBytes()}];f.rehashEvents()
 const original={schema:'soulidity.native-sale-preparation.v1',plan,packet:{...p.packet,expirationEpoch:'6',phase:'PREPARED',signature:null},context:{target:{chainIdentifier:'35834a8a',standard:pin(standard.deployment),custody:pin(custody.deployment),native:pin(p.native),registryId:plan.registryId,configId:plan.configId},economics:{chainIdentifier:'35834a8a',foundation:pin(p.foundation),configId:plan.configId,coinType:normalizeStructTag(plan.coinType)},collection:p.collection?pin(p.collection):null,reviewedSoulId:plan.soulId,reviewedTotal:plan.reviewedTotal},notSignedOrExecuted:true,requiresDurableJournalBeforeSigning:true,remaining:['WALLET_FINAL_PREFLIGHT','EXECUTED_QUALIFICATION','COMPLETE_ORIGINAL_SALE_PROOF','ACTUAL_POST_SALE_USE']}
 return {client:p.client,text:JSON.stringify(original),original,soulId:plan.soulId,finality:f,rows,sellerLock,buyerLock,payouts:[],standard,custody}
}
