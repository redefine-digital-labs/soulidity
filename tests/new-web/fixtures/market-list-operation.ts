import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64,toBase58 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { buildMarketListOperationTransaction,type NativeMarketListSnapshot,type MarketListOperationRecord } from '../../../web/lib/animacraft/market-list-operation'
import { NATIVE_MARKET_PAYMENT_COIN_TYPE } from '../../../web/lib/animacraft/market-buy-types'
import { cancelEventsBcs } from './market-cancel-operation'
export const lid=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
export const listSigner=Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(25))
export const listedReceiptBcs=bcs.struct('SoulListed',{listing_id:bcs.Address,soul_id:bcs.Address,seller:bcs.Address,kiosk_id:bcs.Address,price:bcs.u64()})
export const cancelledReceiptBcs=bcs.struct('SoulListingCancelled',{listing_id:bcs.Address,soul_id:bcs.Address,seller:bcs.Address})
/** Resolved object roles for the exact listing/atomic-unequip graph. */
export function marketListInputRef(snapshot:NativeMarketListSnapshot,objectId:string){
  const owned=[snapshot.bindingId,snapshot.kioskCapId,...(snapshot.equipmentSale?.removals.flatMap(row=>row.kind==='selection'?[]:[row.itemId])??[])]
  const mutable=[snapshot.stateId,snapshot.kioskId,snapshot.release.kioskRegistryId,snapshot.listingId,snapshot.equipmentId]
  return owned.includes(objectId)
    ?{ImmOrOwnedObject:{objectId,version:'2',digest:snapshot.release.soulidityCallableDigest}}
    :{SharedObject:{objectId,initialSharedVersion:'1',mutable:mutable.includes(objectId)}}
}
export async function marketListFixture(options:{kind?:'list'|'reprice';priceAtomic?:string;equipped?:boolean;marketConfigV2Id?:string}={}){
  const kind=options.kind??'list';const priceAtomic=options.priceAtomic??'1000000'
  const snapshot:NativeMarketListSnapshot={schema:'native-market-list-v1',soulId:lid(12),stateId:lid(14),bindingId:lid(13),
    owner:listSigner.toSuiAddress(),kioskId:lid(20),kioskCapId:lid(21),ownershipEpoch:'3',
    creator:lid(71),makerCreator:lid(72),soulCreatorRoyaltyBps:250,makerSourceRoyaltyBps:750,protocolFeeRecipient:lid(73),
    listed:kind==='reprice',listingId:kind==='reprice'?lid(22):null,priceAtomic:kind==='reprice'?'900000':null,equipmentId:null,
    listAvailable:kind==='list',repriceAvailable:kind==='reprice',
    release:{network:'mainnet',protocolConfigId:lid(1),soulidityOriginalPackageId:lid(4),soulidityCallablePackageId:lid(5),
      soulidityCallableDigest:toBase58(new Uint8Array(32).fill(2)),marketConfigV2Id:options.marketConfigV2Id??lid(6),kioskRegistryId:lid(7),soulTransferPolicyId:lid(8),kioskPackageId:lid(9),
      paymentCoinType:NATIVE_MARKET_PAYMENT_COIN_TYPE,writesEnabled:true}}
  if(options.equipped){
    snapshot.equipmentId=lid(90)
    snapshot.equipmentSale={scope:{target:{soulidityCallablePackageId:snapshot.release.soulidityCallablePackageId,
      runtimeOriginalPackageId:lid(91),protocolConfigId:snapshot.release.protocolConfigId},soulStateId:snapshot.stateId,
      equipmentId:lid(90),expectedRevision:'9007199254740993'},definitionRegistryId:lid(92),baseRegistryId:lid(93),
      removals:[{kind:'base',itemId:lid(94)},{kind:'external',itemId:lid(95)},{kind:'selection',selectionIndex:'8'}],
      packs:[{runtimeCallablePackageId:lid(91),paymentCoinType:'0x2::sui::SUI',releaseId:lid(96),bindingIndex:'0'}],
      runtimeCallableDigest:snapshot.release.soulidityCallableDigest,writesEnabled:true}
  }
  const data=buildMarketListOperationTransaction({snapshot,kind,priceAtomic}).getData()
  const tx=Transaction.from(JSON.stringify({...data,inputs:data.inputs.map(input=>{
    if(!input.UnresolvedObject)return input
    const objectId=input.UnresolvedObject.objectId
    return {Object:marketListInputRef(snapshot,objectId)}
  })}))
  tx.setSender(snapshot.owner);tx.setGasOwner(snapshot.owner);tx.setGasPrice('1000');tx.setGasBudget('1000000')
  tx.setGasPayment([{objectId:lid(200),version:'1',digest:snapshot.release.soulidityCallableDigest}]);tx.setExpiration({Epoch:'10'})
  const bytes=await tx.build()
  const record:MarketListOperationRecord={schema:1,kind,snapshot:structuredClone(snapshot),priceAtomic,bytes:toBase64(bytes),
    digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch:'10',phase:'PREPARED',signature:null}
  return {snapshot,record,tx,bytes,kind,priceAtomic}
}
export function marketListEventEvidence(record:MarketListOperationRecord,mutate?:(events:any[])=>void){
  const s=record.snapshot
  const event=(name:string,contents:Uint8Array)=>({package_id:s.release.soulidityCallablePackageId,transaction_module:'market',sender:s.owner,
    type_:{address:s.release.soulidityOriginalPackageId,module:'market',name,typeParams:[]},contents:Array.from(contents)})
  const events=[
    ...(record.kind==='reprice'?[event('SoulListingCancelled',cancelledReceiptBcs.serialize({listing_id:s.listingId!,soul_id:s.soulId,seller:s.owner}).toBytes())]:[]),
    event('SoulListed',listedReceiptBcs.serialize({listing_id:lid(23),soul_id:s.soulId,seller:s.owner,kiosk_id:s.kioskId,price:record.priceAtomic}).toBytes())]
  mutate?.(events)
  const bytes=cancelEventsBcs.serialize({data:events}).toBytes()
  return {bcs:{value:bytes},digest:toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('TransactionEvents::'),...bytes]),{dkLen:32})),events:[]}
}
