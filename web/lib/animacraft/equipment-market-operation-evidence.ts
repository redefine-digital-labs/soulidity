import {bcs} from '@mysten/sui/bcs'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {Transaction} from '@mysten/sui/transactions'
import {fromBase64,toBase64,toHex} from '@mysten/sui/utils'
import {equipmentOperationQuote,validateEquipmentMarketOperationRecord} from './equipment-market-operation'
import type {EquipmentMarketOperationRecord,EquipmentMarketAction} from './equipment-market-operation-types'
import {marketListCheck as check,marketListId} from './market-list-operation'
import {queryExactListingPacketEvidence,type ListingPacketEvidence} from './listing-operation-evidence'

const A=bcs.Address,U=bcs.u64(),V=bcs.vector(bcs.u8())
export const EquipmentMarketOpenedEventBcs=bcs.struct('MarketListingOpenedV8',{
  listing_id:A,registry_id:A,lane:bcs.u8(),root_id:A,asset_id:A,seller:A,ownership_epoch:U,gross_atomic:U,quote_commitment:V,
})
export const EquipmentMarketRepricedEventBcs=bcs.struct('MarketListingRepricedV8',{
  listing_id:A,registry_id:A,lane:bcs.u8(),asset_id:A,seller:A,previous_revision:U,revision:U,
  previous_gross_atomic:U,gross_atomic:U,quote_commitment:V,
})
export const EquipmentMarketSettledEventBcs=bcs.struct('MarketListingSettledV8',{
  listing_id:A,registry_id:A,lane:bcs.u8(),asset_id:A,seller:A,buyer:A,gross_atomic:U,
  protocol_atomic:U,creator_atomic:U,source_atomic:U,seller_atomic:U,
})
export const EquipmentMarketClosedEventBcs=bcs.struct('MarketListingClosedV8',{
  listing_id:A,registry_id:A,lane:bcs.u8(),asset_id:A,seller:A,recovered:bcs.bool(),
})
export const EquipmentMarketCustodyEventBcs=bcs.struct('EquipmentMarketCustodyTransitionV8',{
  action:bcs.u8(),listing_id:A,asset_id:A,asset_kind:bcs.u8(),source_id:A,previous_holder:A,holder:A,
  previous_ownership_epoch:U,ownership_epoch:U,asset_commitment:V,
})
const eventNames={list:'MarketListingOpenedV8',reprice:'MarketListingRepricedV8',buy:'MarketListingSettledV8',
  cancel:'MarketListingClosedV8',recover:'MarketListingClosedV8'} as const
const custodyName='EquipmentMarketCustodyTransitionV8'
export interface EquipmentMarketOperationReceipt {
  action:EquipmentMarketAction;listingId:string;assetId:string;assetKind:'base'|'external';seller:string;
  recipient:string;ownershipEpoch:string;revision:string;status:0|1|2|3;
  grossAtomic:string;protocolAtomic:string;creatorAtomic:string;sourceAtomic:string;sellerAtomic:string;quoteCommitment:string
}
export type EquipmentMarketOperationEvidence={status:'MISSING'|'PENDING'|'FAILED'}|{
  status:'SUCCEEDED';checkpoint:string;receipt:EquipmentMarketOperationReceipt;effects:ReturnType<typeof bcs.TransactionEffects.parse>
}

/** A historical receipt never depends on current asset ownership or availability.
 * Concrete packet validation precedes authenticated event decoding. Non-event
 * listing fields (e.g. terminal revision) are derived from that exact command;
 * historical/current object readback remains a separate required sync step. */
export async function queryEquipmentMarketOperationEvidence(value:EquipmentMarketOperationRecord,
  client:SuiGrpcClient):Promise<EquipmentMarketOperationEvidence>{
  const r=validateEquipmentMarketOperationRecord(value),s=r.snapshot,pin=s.release.equipmentMarket!,runtime=s.release.runtime!
  const name=eventNames[r.action]
  const proof=await queryExactListingPacketEvidence({bytes:r.bytes,digest:r.digest,packagePin:pin,
    requiredEventOrigins:[{moduleName:'market_v8',datatypeName:name,packageId:pin.originalPackageId}]},client)
  if(proof.status!=='SUCCEEDED')return proof
  if(r.action!=='reprice'){
    const runtimeProof=await queryExactListingPacketEvidence({bytes:r.bytes,digest:r.digest,packagePin:runtime,
      requiredEventOrigins:[{moduleName:'runtime_v8',datatypeName:custodyName,packageId:runtime.originalPackageId}]},client)
    check(runtimeProof.status==='SUCCEEDED'&&runtimeProof.checkpoint===proof.checkpoint
      &&JSON.stringify(runtimeProof.effects)===JSON.stringify(proof.effects)&&JSON.stringify(runtimeProof.events)===JSON.stringify(proof.events),
    'Equipment Runtime packet changed during query')
  }
  return {status:'SUCCEEDED',checkpoint:proof.checkpoint,effects:proof.effects,
    receipt:decodeAuthenticatedEquipmentMarketReceipt(r,proof.events.data)}
}

/** Decode a row only AFTER its complete command graph and historical Market /
 * Runtime packet have been authenticated. Batch callers must prove the complete
 * ordered event set before passing this row's two events; never query a fabricated
 * single-item transaction or treat this decoder as packet authentication. */
export function decodeAuthenticatedEquipmentMarketReceipt(
  r:Pick<EquipmentMarketOperationRecord,'action'|'snapshot'|'priceAtomic'|'bytes'>,
  all:Extract<ListingPacketEvidence,{status:'SUCCEEDED'}>['events']['data'],
):EquipmentMarketOperationReceipt{
  const s=r.snapshot,pin=s.release.equipmentMarket!,runtime=s.release.runtime!,name=eventNames[r.action]
  // Count all market-module events, including names for other lanes/actions.
  // A substituted type origin cannot disappear through a narrow address filter.
  const marketEvents=all.filter(e=>e.transaction_module==='market_v8'||e.type_.module==='market_v8')
  check(marketEvents.length===1,'Exactly one equipment Market action receipt required')
  const event=marketEvents[0]
  check(event.package_id===pin.callablePackageId&&event.transaction_module==='market_v8'&&event.sender===s.actor
    &&event.type_.address===pin.originalPackageId&&event.type_.module==='market_v8'
    &&event.type_.name===name&&event.type_.typeParams.length===0,'Equipment Market event authority mismatch')
  const codec=r.action==='list'?EquipmentMarketOpenedEventBcs:r.action==='reprice'?EquipmentMarketRepricedEventBcs:
    r.action==='buy'?EquipmentMarketSettledEventBcs:EquipmentMarketClosedEventBcs
  const raw=Uint8Array.from(event.contents),row=codec.parse(raw)
  check(toBase64((codec as typeof EquipmentMarketOpenedEventBcs).serialize(row as ReturnType<typeof EquipmentMarketOpenedEventBcs.parse>).toBytes())===toBase64(raw),
    'Noncanonical equipment Market receipt')
  check(marketListId(row.listing_id)&&row.registry_id===s.target.registryId&&row.asset_id===s.asset.itemId
    &&row.seller===s.seller&&row.lane===(s.asset.kind==='base'?4:5),'Equipment Market receipt identity or lane mismatch')
  const revision=r.action==='list'?'0':String(BigInt(s.listing!.revision)+1n),quote=equipmentOperationQuote(s,r.priceAtomic)
  if(r.action==='list'){
    const inputs=Transaction.from(fromBase64(r.bytes)).getData().inputs.flatMap(i=>i.Object?.SharedObject?[i.Object.SharedObject.objectId]:
      i.Object?.ImmOrOwnedObject?[i.Object.ImmOrOwnedObject.objectId]:i.Object?.Receiving?[i.Object.Receiving.objectId]:[])
    check(!inputs.includes(row.listing_id),'Equipment listing aliases a transaction input')
    const opened=row as ReturnType<typeof EquipmentMarketOpenedEventBcs.parse>
    check(opened.root_id===s.target.rootId&&opened.ownership_epoch===s.ownershipEpoch
      &&opened.gross_atomic===r.priceAtomic&&toHex(Uint8Array.from(opened.quote_commitment))===quote.commitment,'Equipment opening quote mismatch')
  }else{
    check(row.listing_id===s.listing!.id,'Equipment listing ID mismatch')
    if(r.action==='reprice'){
      const repriced=row as ReturnType<typeof EquipmentMarketRepricedEventBcs.parse>
      check(repriced.previous_revision===s.listing!.revision&&repriced.revision===revision
        &&repriced.previous_gross_atomic===s.listing!.priceAtomic&&repriced.gross_atomic===r.priceAtomic
        &&toHex(Uint8Array.from(repriced.quote_commitment))===quote.commitment,'Equipment reprice revision or quote mismatch')
    }else if(r.action==='buy'){
      const settled=row as ReturnType<typeof EquipmentMarketSettledEventBcs.parse>
      check(settled.buyer===s.actor&&settled.gross_atomic===quote.grossAtomic&&settled.protocol_atomic===quote.protocolAtomic
        &&settled.creator_atomic==='0'&&settled.source_atomic==='0'&&settled.seller_atomic===quote.sellerAtomic,
      'Equipment settlement recipient or proceeds mismatch')
    }else check((row as ReturnType<typeof EquipmentMarketClosedEventBcs.parse>).recovered===(r.action==='recover'),'Equipment closing action mismatch')
  }
  const custodyEvents=all.filter(e=>e.type_.name===custodyName)
  check(custodyEvents.length===(r.action==='reprice'?0:1),'Exact equipment custody transition required')
  const recipient=r.action==='buy'?s.actor:s.seller,ownershipEpoch=r.action==='buy'?String(BigInt(s.ownershipEpoch)+1n):s.ownershipEpoch
  if(r.action!=='reprice'){
    const e=custodyEvents[0]
    check(all.indexOf(e)<all.indexOf(event)&&e.package_id===runtime.callablePackageId&&e.transaction_module==='runtime_v8'&&e.sender===s.actor
      &&e.type_.address===runtime.originalPackageId&&e.type_.module==='runtime_v8'&&e.type_.typeParams.length===0,
    'Equipment custody event authority mismatch')
    const bytes=Uint8Array.from(e.contents),custody=EquipmentMarketCustodyEventBcs.parse(bytes)
    check(toBase64(EquipmentMarketCustodyEventBcs.serialize(custody).toBytes())===toBase64(bytes)
      &&custody.action===(r.action==='list'?0:r.action==='buy'?1:2)&&custody.listing_id===row.listing_id
      &&custody.asset_id===s.asset.itemId&&custody.asset_kind===(s.asset.kind==='base'?0:2)
      &&custody.source_id===(s.asset.kind==='base'?s.asset.baseRegistryId:s.asset.productId)
      &&custody.previous_holder===s.seller&&custody.holder===recipient&&custody.previous_ownership_epoch===s.ownershipEpoch
      &&custody.ownership_epoch===ownershipEpoch&&toHex(Uint8Array.from(custody.asset_commitment))===s.assetCommitment,
    'Equipment custody identity, recipient, epoch or commitment mismatch')
  }
  return {action:r.action,listingId:row.listing_id,
    assetId:s.asset.itemId,assetKind:s.asset.kind,seller:s.seller,recipient,ownershipEpoch,revision,
    status:r.action==='buy'?1:r.action==='cancel'?2:r.action==='recover'?3:0,
    grossAtomic:quote.grossAtomic,protocolAtomic:quote.protocolAtomic,creatorAtomic:'0',sourceAtomic:'0',sellerAtomic:quote.sellerAtomic,
    quoteCommitment:quote.commitment}
}
