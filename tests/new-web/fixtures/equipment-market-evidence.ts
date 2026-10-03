import {vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {fromBase64,fromHex,toBase58} from '@mysten/sui/utils'
import {blake2b} from '@noble/hashes/blake2.js'
import {EquipmentMarketOpenedEventBcs,EquipmentMarketRepricedEventBcs,
  EquipmentMarketSettledEventBcs,EquipmentMarketClosedEventBcs,EquipmentMarketCustodyEventBcs} from '../../../web/lib/animacraft/equipment-market-operation-evidence'
import {equipmentOperationQuote,type EquipmentMarketAction} from '../../../web/lib/animacraft/equipment-market-operation'
import {MAINNET_GENESIS_DIGEST} from '../../../web/lib/animacraft/mainnet-chain'
import {equipmentMarketOperationFixture} from './equipment-market-operation'

const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
export const EquipmentMarketEventsBcs=bcs.struct('TransactionEvents',{data:bcs.vector(bcs.struct('Event',{
  package_id:bcs.Address,transaction_module:bcs.string(),sender:bcs.Address,type_:bcs.StructTag,contents:bcs.vector(bcs.u8()),
}))})
export async function equipmentMarketEvidenceFixture(action:EquipmentMarketAction='list',kind:'base'|'external'='base',equipped=false){
  const f=await equipmentMarketOperationFixture({action,kind,equipped}),r=f.record,s=r.snapshot,market=s.release.equipmentMarket!,runtime=s.release.runtime!
  const listingId=s.listing?.id??id(901),q=equipmentOperationQuote(s,r.priceAtomic)
  const common={listing_id:listingId,registry_id:s.target.registryId,lane:kind==='base'?4:5,asset_id:s.asset.itemId,seller:s.seller}
  const codec=action==='list'?EquipmentMarketOpenedEventBcs:action==='reprice'?EquipmentMarketRepricedEventBcs:
    action==='buy'?EquipmentMarketSettledEventBcs:EquipmentMarketClosedEventBcs
  const fields:any=action==='list'?{...common,root_id:s.target.rootId,ownership_epoch:s.ownershipEpoch,gross_atomic:r.priceAtomic,quote_commitment:[...fromHex(q.commitment)]}:
    action==='reprice'?{...common,previous_revision:s.listing!.revision,revision:String(BigInt(s.listing!.revision)+1n),previous_gross_atomic:s.listing!.priceAtomic,
      gross_atomic:r.priceAtomic,quote_commitment:[...fromHex(q.commitment)]}:
    action==='buy'?{...common,buyer:s.actor,gross_atomic:r.priceAtomic,protocol_atomic:q.protocolAtomic,creator_atomic:'0',source_atomic:'0',seller_atomic:q.sellerAtomic}:
    {...common,recovered:action==='recover'}
  const custody:any={action:action==='list'?0:action==='buy'?1:2,listing_id:listingId,asset_id:s.asset.itemId,asset_kind:kind==='base'?0:2,
    source_id:s.asset.kind==='base'?s.asset.baseRegistryId:s.asset.productId,previous_holder:s.seller,holder:action==='buy'?s.actor:s.seller,
    previous_ownership_epoch:s.ownershipEpoch,ownership_epoch:action==='buy'?String(BigInt(s.ownershipEpoch)+1n):s.ownershipEpoch,asset_commitment:[...fromHex(s.assetCommitment)]}
  const event=(pin:typeof runtime,module:string,name:string,contents:Uint8Array)=>({package_id:pin.callablePackageId,transaction_module:module,sender:s.actor,
    type_:{address:pin.originalPackageId,module,name,typeParams:[]},contents:[...contents]})
  const events:any[]=[...(action==='reprice'?[]:[event(runtime,'runtime_v8','EquipmentMarketCustodyTransitionV8',EquipmentMarketCustodyEventBcs.serialize(custody).toBytes())]),
    event(market,'market_v8',codec.name,codec.serialize(fields).toBytes())]
  const packages=[market,runtime].map((pin,index)=>({objectId:pin.callablePackageId,version:2n,digest:pin.callableDigest,owner:{kind:4},
    package:{storageId:pin.callablePackageId,originalId:pin.originalPackageId,version:2n,typeOrigins:[{moduleName:index?'runtime_v8':'market_v8',
      datatypeName:index?'EquipmentMarketCustodyTransitionV8':codec.name,packageId:pin.originalPackageId}]}}))
  const effects:any={V2:{status:{Success:true},executedEpoch:'9',gasUsed:{computationCost:'1',storageCost:'0',storageRebate:'0',nonRefundableStorageFee:'0'},
    transactionDigest:r.digest,gasObjectIndex:null,eventsDigest:null,dependencies:[],lamportVersion:'3',changedObjects:[],unchangedConsensusObjects:[],auxDataDigest:null}}
  const ledger:any={digest:r.digest,transaction:{digest:r.digest,bcs:{value:fromBase64(r.bytes)}},checkpoint:20n,effects:{transactionDigest:r.digest,status:{success:true}}}
  const refresh=()=>{
    const bytes=EquipmentMarketEventsBcs.serialize({data:events}).toBytes(),digest=toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('TransactionEvents::'),...bytes]),{dkLen:32}))
    ledger.events={bcs:{value:bytes},digest};effects.V2.eventsDigest=digest;ledger.effects.bcs={value:bcs.TransactionEffects.serialize(effects).toBytes()}
  };refresh()
  const client:any={ledgerService:{getServiceInfo:vi.fn(async()=>({response:{chainId:MAINNET_GENESIS_DIGEST}})),
    getTransaction:vi.fn(async()=>({response:{transaction:ledger}})),getObject:vi.fn(async({objectId}:{objectId:string})=>({response:{object:packages.find(p=>p.objectId===objectId)}}))}}
  return {...f,rawClient:f.client,client,events,packages,ledger,effects,refresh,fields,custody,listingId,
    changeMarket(change:(v:any)=>void){change(fields);events[events.length-1].contents=[...codec.serialize(fields).toBytes()];refresh()},
    changeCustody(change:(v:any)=>void){change(custody);events[0].contents=[...EquipmentMarketCustodyEventBcs.serialize(custody).toBytes()];refresh()}}
}
