import {bcs} from '@mysten/sui/bcs'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {Transaction} from '@mysten/sui/transactions'
import {fromBase64,toBase64} from '@mysten/sui/utils'
import {marketListCheck as check,marketListId} from './market-list-operation'
import {validateSelectedMarketSaleOperationRecord,type SelectedMarketSaleOperationRecord} from './selected-market-sale-operation'
import {queryExactListingPacketEvidence,type ListingPacketEvidence,type ListingPacketPackagePin,type ListingPacketEventOrigin} from './listing-operation-evidence'
import {decodeAuthenticatedEquipmentMarketReceipt,type EquipmentMarketOperationReceipt} from './equipment-market-operation-evidence'

export const SelectedSoulListedBcs=bcs.struct('SoulListed',{
  listing_id:bcs.Address,soul_id:bcs.Address,seller:bcs.Address,kiosk_id:bcs.Address,price:bcs.u64(),
})
export type SelectedMarketSaleReceipt={assetType:'soul';receipt:ReturnType<typeof SelectedSoulListedBcs.parse>}|
  {assetType:'equipment';receipt:EquipmentMarketOperationReceipt}
export type SelectedMarketSaleEvidence={status:'MISSING'|'PENDING'|'FAILED'}|{
  status:'SUCCEEDED';checkpoint:string;receipts:SelectedMarketSaleReceipt[];
  effects:ReturnType<typeof bcs.TransactionEffects.parse>
}

/** One saved mixed PTB, one complete ordered sale receipt set. Asset history and
 * current ownership are intentionally left to the required readback stage. */
export async function querySelectedMarketSaleEvidence(value:SelectedMarketSaleOperationRecord,
  client:SuiGrpcClient):Promise<SelectedMarketSaleEvidence>{
  const r=validateSelectedMarketSaleOperationRecord(value),pins=new Map<string,{
    packagePin:ListingPacketPackagePin;requiredEventOrigins:ListingPacketEventOrigin[]}>()
  const add=(packagePin:ListingPacketPackagePin,moduleName:string,datatypeName:string)=>{
    const prior=pins.get(packagePin.callablePackageId)
    check(!prior||prior.packagePin.originalPackageId===packagePin.originalPackageId&&prior.packagePin.callableDigest===packagePin.callableDigest,
      'Selected sale historical package pins disagree')
    const entry=prior??{packagePin,requiredEventOrigins:[]}
    if(!entry.requiredEventOrigins.some(e=>e.moduleName===moduleName&&e.datatypeName===datatypeName))
      entry.requiredEventOrigins.push({moduleName,datatypeName,packageId:packagePin.originalPackageId})
    pins.set(packagePin.callablePackageId,entry)
  }
  for(const row of r.snapshot.rows){
    const release=row.snapshot.release
    if(row.assetType==='soul')add({originalPackageId:release.soulidityOriginalPackageId,
      callablePackageId:release.soulidityCallablePackageId,callableDigest:release.soulidityCallableDigest},'market','SoulListed')
    else{
      add(row.snapshot.release.equipmentMarket!,'market_v8','MarketListingOpenedV8')
      add(row.snapshot.release.runtime!,'runtime_v8','EquipmentMarketCustodyTransitionV8')
    }
  }
  let proof:Extract<ListingPacketEvidence,{status:'SUCCEEDED'}>|undefined
  for(const pin of pins.values()){
    const next=await queryExactListingPacketEvidence({bytes:r.bytes,digest:r.digest,...pin},client)
    if(!proof){if(next.status!=='SUCCEEDED')return next;proof=next}
    else check(next.status==='SUCCEEDED'&&next.checkpoint===proof.checkpoint
      &&JSON.stringify(next.effects)===JSON.stringify(proof.effects)&&JSON.stringify(next.events)===JSON.stringify(proof.events),
    'Selected sale packet changed between historical packages')
  }
  check(proof,'Selected sale packet missing')
  const all=proof.events.data
  const sales=all.filter(e=>['market','market_v8'].includes(e.transaction_module)||['market','market_v8'].includes(e.type_.module)
    ||['SoulListed','MarketListingOpenedV8'].includes(e.type_.name))
  const custody=all.filter(e=>e.type_.name==='EquipmentMarketCustodyTransitionV8')
  check(sales.length===r.snapshot.rows.length&&custody.length===r.snapshot.rows.filter(row=>row.assetType==='equipment').length,
    'Complete selected sale event set required')
  const inputs=Transaction.from(fromBase64(r.bytes)).getData().inputs.flatMap(i=>i.Object?.SharedObject?[i.Object.SharedObject.objectId]:
    i.Object?.ImmOrOwnedObject?[i.Object.ImmOrOwnedObject.objectId]:i.Object?.Receiving?[i.Object.Receiving.objectId]:[])
  const assetIds=r.snapshot.rows.map(row=>row.assetType==='soul'?row.snapshot.soulId:row.snapshot.asset.itemId)
  const listingIds=new Set<string>(),receipts:SelectedMarketSaleReceipt[]=[]
  let custodyIndex=0,previousSaleIndex=-1
  for(const [index,row] of r.snapshot.rows.entries()){
    const event=sales[index],saleIndex=all.indexOf(event)
    let listingId:string
    if(row.assetType==='soul'){
      const s=row.snapshot,p=s.release
      check(event.package_id===p.soulidityCallablePackageId&&event.transaction_module==='market'&&event.sender===r.snapshot.owner
        &&event.type_.address===p.soulidityOriginalPackageId&&event.type_.module==='market'&&event.type_.name==='SoulListed'
        &&event.type_.typeParams.length===0,'Selected Soul listing event authority mismatch')
      const bytes=Uint8Array.from(event.contents),receipt=SelectedSoulListedBcs.parse(bytes)
      check(toBase64(SelectedSoulListedBcs.serialize(receipt).toBytes())===toBase64(bytes)&&receipt.soul_id===s.soulId
        &&receipt.seller===r.snapshot.owner&&receipt.kiosk_id===s.kioskId&&receipt.price===row.priceAtomic,
      'Selected Soul listing identity, order or price mismatch')
      listingId=receipt.listing_id;receipts.push({assetType:'soul',receipt})
    }else{
      const transition=custody[custodyIndex++],transitionIndex=all.indexOf(transition)
      check(transitionIndex>previousSaleIndex&&transitionIndex<saleIndex,'Selected equipment custody order mismatch')
      const receipt=decodeAuthenticatedEquipmentMarketReceipt({action:'list',snapshot:row.snapshot,priceAtomic:row.priceAtomic,bytes:r.bytes},[transition,event])
      listingId=receipt.listingId;receipts.push({assetType:'equipment',receipt})
    }
    check(marketListId(listingId)&&!listingIds.has(listingId)&&!inputs.includes(listingId)&&!assetIds.includes(listingId),
      'Selected sale listing ID reused or aliases an input/asset')
    listingIds.add(listingId);previousSaleIndex=saleIndex
  }
  return {status:'SUCCEEDED',checkpoint:proof.checkpoint,effects:proof.effects,receipts}
}
