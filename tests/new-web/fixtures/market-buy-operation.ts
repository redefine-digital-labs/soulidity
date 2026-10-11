import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64, toBase58 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { quoteAnimacraftV8SoulSale } from '@soulidity/sdk'
import { buildMarketBuyOperationTransaction, type MarketBuySnapshot, type MarketBuyOperationRecord } from '../../../web/lib/animacraft/market-buy-operation'
import { NATIVE_MARKET_PAYMENT_COIN_TYPE } from '../../../web/lib/animacraft/market-buy-types'
import { cancelEventsBcs } from './market-cancel-operation'
export const bid=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
export const buySigner=Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(23))
export const buyCoinBcs=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()})
export const buyReceiptBcs=bcs.struct('AnimacraftV8SoulPurchased',{
  listing_id:bcs.Address,soul_id:bcs.Address,provenance_id:bcs.Address,seller:bcs.Address,buyer:bcs.Address,maker_source_recipient:bcs.Address,
  price:bcs.u64(),seller_payout:bcs.u64(),protocol_fee:bcs.u64(),soul_creator_royalty_bps:bcs.u16(),soul_creator_royalty:bcs.u64(),
  maker_source_royalty_bps:bcs.u16(),maker_source_royalty:bcs.u64(),
})
export async function marketBuyFixture(options:{newKiosk?:boolean;balances?:string[]}={}){
  const snapshot:MarketBuySnapshot={schema:'native-market-buy-v1',soulId:bid(12),stateId:bid(14),bindingId:bid(13),seller:bid(70),sellerKioskId:bid(20),
    ownershipEpoch:'3',listingId:bid(22),priceAtomic:'1000000',creator:bid(71),makerCreator:bid(72),soulCreatorRoyaltyBps:250,makerSourceRoyaltyBps:750,
    protocolFeeRecipient:bid(73),buyer:buySigner.toSuiAddress(),buyerKioskId:options.newKiosk?null:bid(30),buyerKioskCapId:options.newKiosk?null:bid(31),purchaseAvailable:true,
    release:{network:'mainnet',protocolConfigId:bid(1),soulidityOriginalPackageId:bid(4),soulidityCallablePackageId:bid(5),
      soulidityCallableDigest:toBase58(new Uint8Array(32).fill(2)),marketConfigV2Id:bid(6),kioskRegistryId:bid(7),soulTransferPolicyId:bid(8),kioskPackageId:bid(9),
      paymentCoinType:NATIVE_MARKET_PAYMENT_COIN_TYPE,writesEnabled:true}}
  const paymentCoins=(options.balances??['600000','500000']).map((balanceAtomic,index)=>({objectId:bid(50+index),version:'2',digest:snapshot.release.soulidityCallableDigest,balanceAtomic}))
  const data=buildMarketBuyOperationTransaction({snapshot,paymentCoins}).getData()
  const tx=Transaction.from(JSON.stringify({...data,inputs:data.inputs.map(input=>{
    if(!input.UnresolvedObject)return input
    const objectId=input.UnresolvedObject.objectId
    const coin=paymentCoins.find(c=>c.objectId===objectId)
    return {Object:coin||objectId===snapshot.bindingId||objectId===snapshot.buyerKioskCapId
      ?{ImmOrOwnedObject:{objectId,version:'2',digest:snapshot.release.soulidityCallableDigest}}
      :{SharedObject:{objectId,initialSharedVersion:'1',mutable:![snapshot.release.marketConfigV2Id,snapshot.release.soulTransferPolicyId].includes(objectId)}}}
  })}))
  tx.setSender(snapshot.buyer);tx.setGasOwner(snapshot.buyer);tx.setGasPrice('1000');tx.setGasBudget('1000000')
  tx.setGasPayment([{objectId:bid(200),version:'1',digest:snapshot.release.soulidityCallableDigest}]);tx.setExpiration({Epoch:'10'})
  const bytes=await tx.build()
  const record:MarketBuyOperationRecord={schema:1,kind:'buy',snapshot:structuredClone(snapshot),paymentCoins:structuredClone(paymentCoins),bytes:toBase64(bytes),
    digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch:'10',phase:'PREPARED',signature:null}
  const objects=new Map(paymentCoins.map(c=>[c.objectId,{objectId:c.objectId,version:BigInt(c.version),digest:c.digest,owner:{kind:1,address:snapshot.buyer},
    objectType:`0x2::coin::Coin<${snapshot.release.paymentCoinType}>`,contents:{value:buyCoinBcs.serialize({id:c.objectId,balance:c.balanceAtomic}).toBytes()}}]))
  return {snapshot,record,tx,bytes,objects,paymentCoins}
}
export function marketBuyEventEvidence(record:MarketBuyOperationRecord,mutate?:(value:any)=>void){
  const s=record.snapshot;const quote=quoteAnimacraftV8SoulSale(BigInt(s.priceAtomic),s)
  const receipt={listing_id:s.listingId,soul_id:s.soulId,provenance_id:s.bindingId,seller:s.seller,buyer:s.buyer,maker_source_recipient:s.makerCreator,
    price:s.priceAtomic,seller_payout:String(quote.sellerPayoutAtomic),protocol_fee:String(quote.protocolFeeAtomic),soul_creator_royalty_bps:s.soulCreatorRoyaltyBps,
    soul_creator_royalty:String(quote.soulCreatorRoyaltyAtomic),maker_source_royalty_bps:s.makerSourceRoyaltyBps,maker_source_royalty:String(quote.makerSourceRoyaltyAtomic)}
  mutate?.(receipt)
  const bytes=cancelEventsBcs.serialize({data:[{package_id:s.release.soulidityCallablePackageId,transaction_module:'market',sender:s.buyer,
    type_:{address:s.release.soulidityOriginalPackageId,module:'market',name:'AnimacraftV8SoulPurchased',typeParams:[]},contents:Array.from(buyReceiptBcs.serialize(receipt).toBytes())}]}).toBytes()
  return {bcs:{value:bytes},digest:toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('TransactionEvents::'),...bytes]),{dkLen:32})),events:[]}
}
