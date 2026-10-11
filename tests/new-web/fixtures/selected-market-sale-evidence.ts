import {Inputs,Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {fromBase64,fromHex,toBase64} from '@mysten/sui/utils'
import {equipmentMarketEvidenceFixture} from './equipment-market-evidence'
import {emid} from './equipment-market-operation'
import {marketListFixture} from './market-list-operation'
import {readSelectedMarketSaleSnapshot,buildSelectedMarketSaleTransaction} from '../../../web/lib/animacraft/selected-market-sale-snapshot'
import {selectedMarketSaleInputRoles,type SelectedMarketSaleOperationRecord} from '../../../web/lib/animacraft/selected-market-sale-operation'
import {readSelectedSaleEquipment} from '../../../web/lib/animacraft/native-selected-equipment-sale'
import {equipmentOperationQuote} from '../../../web/lib/animacraft/equipment-market-operation'
import {EquipmentMarketOpenedEventBcs,EquipmentMarketCustodyEventBcs} from '../../../web/lib/animacraft/equipment-market-operation-evidence'
import {SelectedSoulListedBcs} from '../../../web/lib/animacraft/selected-market-sale-evidence'
import type {NativeMarketBuyTarget} from '../../../web/lib/animacraft/native-market-buy-snapshot'

export async function selectedMarketSaleEvidenceFixture(includeSoul=true){
  const f=await equipmentMarketEvidenceFixture('list','base',true),equipmentScope={soulId:emid(12),stateId:emid(14)}
  const snapshot=await readSelectedMarketSaleSnapshot(f.rawClient,f.target,{} as NativeMarketBuyTarget,{owner:f.owner,selection:[
    {assetType:'equipment',rootId:f.rootId,itemId:f.itemId,kind:'base',priceAtomic:'10001',equipmentScope},
    {assetType:'equipment',rootId:f.rootId,itemId:emid(102),kind:'external',priceAtomic:'20001',equipmentScope},
  ]})
  if(includeSoul){
    // Controlled valid Soul snapshot joined to the raw equipment group. This is
    // deliberately not represented as full raw mixed-chain read acceptance.
    const soul=(await marketListFixture()).snapshot
    Object.assign(soul,{owner:f.owner,soulId:emid(12),stateId:emid(14),equipmentId:emid(80),ownershipEpoch:snapshot.rows[0].snapshot.ownershipEpoch})
    Object.assign(soul.release,{soulidityOriginalPackageId:f.target.soulidityOriginalPackageId,soulidityCallablePackageId:f.target.soulidityCallablePackageId,
      soulidityCallableDigest:f.target.soulidityCallableDigest,protocolConfigId:f.target.protocolConfigId,
      marketConfigV2Id:emid(700),kioskRegistryId:emid(701),soulTransferPolicyId:emid(702),kioskPackageId:emid(703)})
    const group=await readSelectedSaleEquipment(f.rawClient,f.target,f.owner,[{...equipmentScope,sellSoul:true,
      items:[{kind:'base',itemId:f.itemId},{kind:'external',itemId:emid(102)}]}])
    soul.equipmentSale={...group.preparations[0].equipment!.plan,runtimeCallableDigest:f.target.runtime!.callableDigest,writesEnabled:true}
    snapshot.rows.unshift({assetType:'soul',snapshot:soul,priceAtomic:'30001'});snapshot.equipment=group.preparations
    const p=soul.release
    f.packages.push({objectId:p.soulidityCallablePackageId,version:2n,digest:p.soulidityCallableDigest,owner:{kind:4},package:{
      storageId:p.soulidityCallablePackageId,originalId:p.soulidityOriginalPackageId,version:2n,
      typeOrigins:[{moduleName:'market',datatypeName:'SoulListed',packageId:p.soulidityOriginalPackageId}],
    }})
  }
  const roles=selectedMarketSaleInputRoles(snapshot),data=buildSelectedMarketSaleTransaction(snapshot).getData()
  data.inputs=data.inputs.map(input=>{
    if(!input.UnresolvedObject)return input
    const objectId=input.UnresolvedObject.objectId,row=snapshot.rows.find(row=>row.assetType==='equipment'&&row.snapshot.asset.itemId===objectId)
    const ref=row?.assetType==='equipment'?row.snapshot.reference:{objectId,version:'2',digest:f.target.outputCallableDigest}
    return roles.owned.has(objectId)?Inputs.ObjectRef(ref):Inputs.SharedObjectRef({objectId,initialSharedVersion:'1',mutable:roles.mutable.has(objectId)})
  })
  const tx=Transaction.from(JSON.stringify(data));tx.setSender(f.owner);tx.setGasOwner(f.owner);tx.setGasPrice(1);tx.setGasBudget(100000)
  tx.setGasPayment([{objectId:emid(950),version:'2',digest:f.target.outputCallableDigest}]);tx.setExpiration({Epoch:9})
  const bytes=await tx.build(),record:SelectedMarketSaleOperationRecord={schema:1,kind:'batch-list',snapshot,bytes:toBase64(bytes),
    digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch:'9',phase:'PREPARED',signature:null}
  f.ledger.digest=record.digest;f.ledger.transaction={digest:record.digest,bcs:{value:fromBase64(record.bytes)}}
  f.ledger.effects.transactionDigest=record.digest;f.effects.V2.transactionDigest=record.digest;f.events.length=0
  const event=(original:string,callable:string,module:string,name:string,contents:Uint8Array)=>({package_id:callable,transaction_module:module,
    sender:f.owner,type_:{address:original,module,name,typeParams:[]},contents:[...contents]})
  for(const [index,row] of snapshot.rows.entries()){
    const listing_id=emid(900+index)
    if(row.assetType==='soul'){
      const s=row.snapshot,p=s.release
      f.events.push(event(p.soulidityOriginalPackageId,p.soulidityCallablePackageId,'market','SoulListed',SelectedSoulListedBcs.serialize({
        listing_id,soul_id:s.soulId,seller:f.owner,kiosk_id:s.kioskId,price:row.priceAtomic}).toBytes()))
    }else{
      const s=row.snapshot,p=s.release.equipmentMarket!,rt=s.release.runtime!,q=equipmentOperationQuote(s,row.priceAtomic)
      f.events.push(event(rt.originalPackageId,rt.callablePackageId,'runtime_v8','EquipmentMarketCustodyTransitionV8',EquipmentMarketCustodyEventBcs.serialize({
        action:0,listing_id,asset_id:s.asset.itemId,asset_kind:s.asset.kind==='base'?0:2,source_id:s.asset.kind==='base'?s.asset.baseRegistryId:s.asset.productId,
        previous_holder:f.owner,holder:f.owner,previous_ownership_epoch:s.ownershipEpoch,ownership_epoch:s.ownershipEpoch,asset_commitment:[...fromHex(s.assetCommitment)],
      }).toBytes()))
      f.events.push(event(p.originalPackageId,p.callablePackageId,'market_v8','MarketListingOpenedV8',EquipmentMarketOpenedEventBcs.serialize({
        listing_id,registry_id:s.target.registryId,lane:s.asset.kind==='base'?4:5,root_id:s.target.rootId,asset_id:s.asset.itemId,seller:f.owner,
        ownership_epoch:s.ownershipEpoch,gross_atomic:row.priceAtomic,quote_commitment:[...fromHex(q.commitment)],
      }).toBytes()))
    }
  }
  f.refresh();return {...f,record}
}
