import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { quoteAnimacraftV8SoulSale } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from './mainnet-chain'
import { validateMarketCancelCheckpoint } from './market-cancel-checkpoint'
import { buildMarketBuyOperationTransaction, marketBuyCheck as check, marketBuyCanonical,
  validateMarketBuySnapshot, validateMarketBuyOperationRecord, type MarketBuySnapshot,
  type MarketBuyOperationRecord, type MarketBuyOperationAdapter } from './market-buy-operation'
import {selectMarketPaymentCoins,recheckMarketPaymentCoins} from './market-payment-coins'
import {readTransactionGasWindow,setTransactionGasWindow,simulateExactAddressGas} from '../sui/transaction-gas-window'
import {proveSuiAddressGas} from '../sui/address-balance-effects'
import {queryExactListingPacketEvidence,type ListingPacketEvidence} from './listing-operation-evidence'

const TIMEOUT_MS=25_000
async function bounded<T>(work:(signal:AbortSignal)=>PromiseLike<T>, timeoutMs=TIMEOUT_MS):Promise<T> {
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new Error('Purchase request timed out; recover the saved transaction'))},timeoutMs)
  })])}finally{clearTimeout(timer)}
}
const PurchaseBcs=bcs.struct('AnimacraftV8SoulPurchased',{
  listing_id:bcs.Address,soul_id:bcs.Address,provenance_id:bcs.Address,seller:bcs.Address,buyer:bcs.Address,maker_source_recipient:bcs.Address,
  price:bcs.u64(),seller_payout:bcs.u64(),protocol_fee:bcs.u64(),soul_creator_royalty_bps:bcs.u16(),soul_creator_royalty:bcs.u64(),
  maker_source_royalty_bps:bcs.u16(),maker_source_royalty:bcs.u64(),
})
function buyGasPacket(record:MarketBuyOperationRecord){
  const {gasData,expiration}=Transaction.from(fromBase64(record.bytes)).getData()
  const window=readTransactionGasWindow({gasData,expiration},MAINNET_GENESIS_DIGEST,record.expirationEpoch)
  check(window,'Purchase sender/gas/expiration mismatch')
  return {window,gasData}
}
/** Purchases use verified address-owned USDC, never a cached JSON balance or
 * ambient coin/package configuration. Queries and sync remain owner/gate free. */
export function createMarketBuyOperationAdapter(params:{client:SuiGrpcClient;read:(listingId?:string)=>Promise<MarketBuySnapshot>;
  observed?:MarketBuySnapshot;getAddress:()=>string|null;sign:(tx:Transaction)=>Promise<{bytes:string;signature:string}>;
  sync:(record:MarketBuyOperationRecord)=>Promise<'COMPLETE'|'SUPERSEDED'>}):MarketBuyOperationAdapter {
  const {client,read,getAddress,sign,sync}=params
  const observed=params.observed?validateMarketBuySnapshot(params.observed):undefined
  async function chain(){const {response}=await bounded(abort=>client.ledgerService.getServiceInfo({}, {abort,timeout:TIMEOUT_MS}));check(response.chainId===MAINNET_GENESIS_DIGEST,'Mainnet purchase RPC required')}
  async function epoch(){const {response}=await bounded(abort=>client.ledgerService.getEpoch({readMask:{paths:['epoch']}},{abort,timeout:TIMEOUT_MS}));
    const value=response.epoch?.epoch;check(typeof value==='bigint'&&value>=0n&&value<18446744073709551615n,'Current epoch unavailable');return value}
  async function fresh(listingId?:string){await chain();return validateMarketBuySnapshot(await bounded(()=>read(listingId)))}
  function writable(s:MarketBuySnapshot){check(s.purchaseAvailable&&s.release.writesEnabled&&s.buyer!==s.seller&&s.buyerKioskId!==s.sellerKioskId,
    'Native purchase is unavailable or signing is disabled');check(getAddress()===s.buyer,'Connect the verified buyer wallet')}
  function same(s:MarketBuySnapshot,old:MarketBuySnapshot){
    // All economic/identity/target fields, including new-vs-existing kiosk, must
    // match the user's observed quote. Dynamic flags are checked separately.
    const fixed=(v:MarketBuySnapshot)=>marketBuyCanonical({...v,purchaseAvailable:undefined,release:{...v.release,writesEnabled:undefined}})
    check(fixed(s)===fixed(old),'Native purchase listing, quote, buyer kiosk or release changed')
  }
  async function recheckCoins(record:MarketBuyOperationRecord){
    await recheckMarketPaymentCoins(client,{owner:record.snapshot.buyer,paymentCoinType:record.snapshot.release.paymentCoinType},record.paymentCoins)
  }
  async function simulateAddressGas(record:MarketBuyOperationRecord){
    if(!buyGasPacket(record).window.addressGas)return
    check(await bounded(signal=>simulateExactAddressGas(client,record.bytes,signal)),'Exact purchase address-gas simulation failed')
  }
  return {
    async prepare(){
      check(observed,'Refresh the native purchase quote before acting')
      const snapshot=await fresh(observed.listingId);same(snapshot,observed);writable(snapshot)
      const paymentCoins=await selectMarketPaymentCoins(client,{owner:snapshot.buyer,paymentCoinType:snapshot.release.paymentCoinType,
        priceAtomic:snapshot.priceAtomic})
      const data=buildMarketBuyOperationTransaction({snapshot,paymentCoins}).getData()
      // Pin the verified payment references instead of silently refreshing them
      // during the SDK's gas/shared-object resolution.
      const tx=Transaction.from(JSON.stringify({...data,inputs:data.inputs.map(input=>{
        const payment=paymentCoins.find(c=>c.objectId===input.UnresolvedObject?.objectId)
        return payment?{Object:{ImmOrOwnedObject:{objectId:payment.objectId,version:payment.version,digest:payment.digest}}}:input
      })}))
      tx.setSender(snapshot.buyer)
      const expirationEpoch=setTransactionGasWindow(tx,MAINNET_GENESIS_DIGEST,await epoch())
      let bytes=await bounded(()=>tx.build({client}))
      const resolved=Transaction.from(bytes)
      if(resolved.getData().gasData.payment?.length){
        // Explicit SUI coins already make the legacy Epoch packet unique.
        resolved.setExpiration({Epoch:expirationEpoch})
        bytes=await resolved.build()
      }
      const record=validateMarketBuyOperationRecord({schema:1,kind:'buy',snapshot,paymentCoins,bytes:toBase64(bytes),
        digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch,phase:'PREPARED',signature:null})
      await recheckCoins(record)
      await simulateAddressGas(record)
      check(getAddress()===snapshot.buyer,'Wallet changed while preparing purchase')
      return record
    },
    async preflight(value){const record=validateMarketBuyOperationRecord(value)
      check(['PREPARED','SIGNING','SIGNED'].includes(record.phase),'Terminal purchase cannot sign or rebroadcast')
      const current=await fresh(record.snapshot.listingId);same(current,record.snapshot);writable(current)
      await recheckCoins(record)
      const {window}=buyGasPacket(record),now=await epoch()
      check(now>=BigInt(window.min)&&now<=BigInt(window.max),'Saved purchase outside its epoch window or expired; query the original')
      await simulateAddressGas(record)
      check(getAddress()===record.snapshot.buyer,'Wallet changed during purchase preflight')
    },
    async sign(value){const record=validateMarketBuyOperationRecord(value)
      check(['PREPARED','SIGNING'].includes(record.phase)&&getAddress()===record.snapshot.buyer,'Wallet changed or purchase cannot request signature')
      return bounded(()=>sign(Transaction.from(fromBase64(record.bytes))),120_000)
    },
    async verifySignature(value){const record=validateMarketBuyOperationRecord(value);check(record.signature,'Purchase signature missing')
      await bounded(()=>verifyTransactionSignature(fromBase64(record.bytes),record.signature!,{address:record.snapshot.buyer,client}))
    },
    async broadcast(value){const record=validateMarketBuyOperationRecord(value)
      check(record.phase==='SIGNED'&&record.signature&&getAddress()===record.snapshot.buyer,'Wallet changed; only saved active signed purchase may broadcast')
      await bounded(signal=>client.core.executeTransaction({transaction:fromBase64(record.bytes),signatures:[record.signature!],signal}))
    },
    async sync(value){const record=validateMarketBuyOperationRecord(value);return bounded(()=>sync(record))},
    async expiryCheckpoint(value){const record=validateMarketBuyOperationRecord(value);await chain()
      const {response}=await bounded(abort=>client.ledgerService.getCheckpoint({checkpointId:{oneofKind:undefined},readMask:{paths:['sequence_number','digest','summary','signature']}},{abort,timeout:TIMEOUT_MS}))
      const checkpoint=response.checkpoint;const summary=checkpoint?.summary
      check(checkpoint&&summary?.bcs?.value&&checkpoint.digest===summary.digest&&typeof summary.epoch==='bigint'&&typeof summary.sequenceNumber==='bigint'
        &&checkpoint.sequenceNumber===summary.sequenceNumber&&checkpoint.signature?.epoch===summary.epoch&&checkpoint.signature.signature?.length===48&&checkpoint.signature.bitmap?.length,
      'Executed purchase checkpoint evidence unavailable or inconsistent')
      return validateMarketCancelCheckpoint({bytes:toBase64(summary.bcs.value),digest:checkpoint.digest,epoch:String(summary.epoch),sequenceNumber:String(summary.sequenceNumber)},record.expirationEpoch)
    },
    async query(value){return (await queryMarketBuyOperationEvidence(value,client)).status},
  }
}

export type MarketBuyOperationEvidence = {status:'MISSING'|'PENDING'|'FAILED'} | {
  status:'SUCCEEDED';checkpoint:string;receipt:ReturnType<typeof PurchaseBcs.parse>;
  effects:ReturnType<typeof bcs.TransactionEffects.parse>;originalPackageId:string
  checkpointProof?:Extract<ListingPacketEvidence,{status:'SUCCEEDED'}>['checkpointProof']
  addressGas?:ReturnType<typeof proveSuiAddressGas>
}

/** Shared historical proof for query and browser post-success readback. */
export async function queryMarketBuyOperationEvidence(value:MarketBuyOperationRecord,client:SuiGrpcClient):Promise<MarketBuyOperationEvidence> {
  const record=validateMarketBuyOperationRecord(value),s=record.snapshot,release=s.release
  const {window:executionWindow,gasData}=buyGasPacket(record)
  const eventName='AnimacraftV8SoulPurchased',originalPackageId=release.soulidityOriginalPackageId
  const proof=await queryExactListingPacketEvidence({
    bytes:record.bytes,digest:record.digest,executionWindow,
    verifyCheckpoint:executionWindow.addressGas?true:undefined,
    packagePin:{originalPackageId,callablePackageId:release.soulidityCallablePackageId,callableDigest:release.soulidityCallableDigest},
    requiredEventOrigins:[{moduleName:'market',datatypeName:eventName,packageId:originalPackageId}],
  },client)
  if(proof.status!=='SUCCEEDED')return proof
  const matches=proof.events.data.filter(event=>event.type_.address===originalPackageId
    &&event.type_.module==='market'&&event.type_.name===eventName)
  check(matches.length===1,'Unique native purchase event required')
  const event=matches[0]
  check(event.package_id===release.soulidityCallablePackageId&&event.transaction_module==='market'
    &&event.sender===s.buyer&&event.type_.typeParams.length===0&&event.contents.length===236,
  'Native purchase event authority mismatch')
  const eventBytes=Uint8Array.from(event.contents),receipt=PurchaseBcs.parse(eventBytes)
  const quote=quoteAnimacraftV8SoulSale(BigInt(s.priceAtomic),s)
  check(toBase64(PurchaseBcs.serialize(receipt).toBytes())===toBase64(eventBytes)
    &&receipt.listing_id===s.listingId&&receipt.soul_id===s.soulId&&receipt.provenance_id===s.bindingId&&receipt.seller===s.seller
    &&receipt.buyer===s.buyer&&receipt.maker_source_recipient===s.makerCreator&&receipt.price===s.priceAtomic
    &&receipt.soul_creator_royalty_bps===s.soulCreatorRoyaltyBps&&receipt.maker_source_royalty_bps===s.makerSourceRoyaltyBps
    &&BigInt(receipt.protocol_fee)===quote.protocolFeeAtomic&&BigInt(receipt.soul_creator_royalty)===quote.soulCreatorRoyaltyAtomic
    &&BigInt(receipt.maker_source_royalty)===quote.makerSourceRoyaltyAtomic&&BigInt(receipt.seller_payout)===quote.sellerPayoutAtomic,
  'Native purchase receipt identity or settlement mismatch')
  const {checkpoint,effects,checkpointProof}=proof
  if(executionWindow.addressGas){
    check(checkpointProof&&gasData.owner&&gasData.budget,'Native purchase address gas proof unavailable')
    const addressGas=proveSuiAddressGas({effects,transactionDigest:record.digest,owner:gasData.owner,budget:gasData.budget})
    return {status:'SUCCEEDED',checkpoint,receipt,effects,originalPackageId,checkpointProof,addressGas}
  }
  return {status:'SUCCEEDED',checkpoint,receipt,effects,originalPackageId}
}
