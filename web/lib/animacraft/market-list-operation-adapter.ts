import { bcs } from '@mysten/sui/bcs'
import {queryListingPacketEvidence} from './listing-operation-evidence'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { MAINNET_GENESIS_DIGEST } from './mainnet-chain'
import { validateMarketCancelCheckpoint } from './market-cancel-checkpoint'
import { buildMarketListOperationTransaction, marketListCheck as check, marketListId, marketListCanonical,
  validateMarketListSnapshot, validateMarketListOperationRecord, type MarketListSnapshot,
  type MarketListOperationRecord, type MarketListOperationAdapter } from './market-list-operation'

const TIMEOUT_MS=25_000
async function bounded<T>(work:(signal:AbortSignal)=>PromiseLike<T>, timeoutMs=TIMEOUT_MS):Promise<T> {
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new Error('Listing request timed out; recover the saved transaction'))},timeoutMs)
  })])}finally{clearTimeout(timer)}
}
const ListedBcs=bcs.struct('SoulListed',{listing_id:bcs.Address,soul_id:bcs.Address,seller:bcs.Address,kiosk_id:bcs.Address,price:bcs.u64()})
const CancelledBcs=bcs.struct('SoulListingCancelled',{listing_id:bcs.Address,soul_id:bcs.Address,seller:bcs.Address})
/** Exact listing/reprice transactions only. Receipt recovery never needs today's
 * owner, active listing, fee/enable flag or connected wallet. */
export function createMarketListOperationAdapter(params:{client:SuiGrpcClient;read:(listingId?:string,capId?:string)=>Promise<MarketListSnapshot>;
  observed?:MarketListSnapshot;intent?:'list'|'reprice';priceAtomic?:bigint;getAddress:()=>string|null;sign:(tx:Transaction)=>Promise<{bytes:string;signature:string}>;
  sync:(record:MarketListOperationRecord)=>Promise<'COMPLETE'|'SUPERSEDED'>}):MarketListOperationAdapter {
  const {client,read,getAddress,sign,sync,intent,priceAtomic}=params
  const observed=params.observed?validateMarketListSnapshot(params.observed):undefined
  async function chain(){const {response}=await bounded(abort=>client.ledgerService.getServiceInfo({}, {abort,timeout:TIMEOUT_MS}));check(response.chainId===MAINNET_GENESIS_DIGEST,'Mainnet listing RPC required')}
  async function epoch(){const {response}=await bounded(abort=>client.ledgerService.getEpoch({readMask:{paths:['epoch']}},{abort,timeout:TIMEOUT_MS}));
    const value=response.epoch?.epoch;check(typeof value==='bigint'&&value>=0n&&value<18446744073709551615n,'Current epoch unavailable');return value}
  async function fresh(listingId?:string,capId?:string){await chain();return validateMarketListSnapshot(await bounded(()=>read(listingId,capId)))}
  function writable(s:MarketListSnapshot,kind:'list'|'reprice'){
    check(s.release.writesEnabled&&(s.equipmentId===null||s.equipmentSale?.writesEnabled===true)
      &&(kind==='list'?s.listAvailable&&!s.listed:s.repriceAvailable&&s.listed&&s.equipmentId===null),
      'Native listing is unavailable or signing is disabled')
    check(getAddress()===s.owner,'Connect the verified seller wallet')
  }
  function same(s:MarketListSnapshot,old:MarketListSnapshot){
    const fixed=(v:MarketListSnapshot)=>marketListCanonical({...v,listAvailable:undefined,repriceAvailable:undefined,release:{...v.release,writesEnabled:undefined}})
    check(fixed(s)===fixed(old),'Native listing, custody, price or release changed')
  }
  return {
    async prepare(){
      check(observed&&['list','reprice'].includes(intent as string)&&typeof priceAtomic==='bigint'
        &&priceAtomic>0n&&priceAtomic<=18446744073709551615n,'Refresh the native listing and choose an exact intent/price before acting')
      const kind=intent!;const snapshot=await fresh(observed.listingId??undefined,observed.kioskCapId);same(snapshot,observed);writable(snapshot,kind)
      const expirationEpoch=String(await epoch()+1n)
      const tx=buildMarketListOperationTransaction({snapshot,kind,priceAtomic:String(priceAtomic)})
      tx.setSender(snapshot.owner);tx.setExpiration({Epoch:expirationEpoch})
      const bytes=await bounded(()=>tx.build({client}))
      const record=validateMarketListOperationRecord({schema:1,kind,snapshot,priceAtomic:String(priceAtomic),bytes:toBase64(bytes),
        digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch,phase:'PREPARED',signature:null})
      check(getAddress()===snapshot.owner,'Wallet changed while preparing listing')
      return record
    },
    async preflight(value){const record=validateMarketListOperationRecord(value)
      check(['PREPARED','SIGNING','SIGNED'].includes(record.phase),'Terminal listing cannot sign or rebroadcast')
      const current=await fresh(record.snapshot.listingId??undefined,record.snapshot.kioskCapId);same(current,record.snapshot);writable(current,record.kind)
      check(await epoch()<=BigInt(record.expirationEpoch),'Saved listing expired; query or retire without rebuilding it')
      check(getAddress()===record.snapshot.owner,'Wallet changed during listing preflight')
    },
    async sign(value){const record=validateMarketListOperationRecord(value)
      check(['PREPARED','SIGNING'].includes(record.phase)&&getAddress()===record.snapshot.owner,'Wallet changed or listing cannot request signature')
      return bounded(()=>sign(Transaction.from(fromBase64(record.bytes))),120_000)
    },
    async verifySignature(value){const record=validateMarketListOperationRecord(value);check(record.signature,'Listing signature missing')
      await bounded(()=>verifyTransactionSignature(fromBase64(record.bytes),record.signature!,{address:record.snapshot.owner,client}))
    },
    async broadcast(value){const record=validateMarketListOperationRecord(value)
      check(record.phase==='SIGNED'&&record.signature&&getAddress()===record.snapshot.owner,'Wallet changed; only saved active signed listing may broadcast')
      await bounded(signal=>client.core.executeTransaction({transaction:fromBase64(record.bytes),signatures:[record.signature!],signal}))
    },
    async sync(value){const record=validateMarketListOperationRecord(value);return bounded(()=>sync(record))},
    async expiryCheckpoint(value){const record=validateMarketListOperationRecord(value);await chain()
      const {response}=await bounded(abort=>client.ledgerService.getCheckpoint({checkpointId:{oneofKind:undefined},readMask:{paths:['sequence_number','digest','summary','signature']}},{abort,timeout:TIMEOUT_MS}))
      const checkpoint=response.checkpoint;const summary=checkpoint?.summary
      check(checkpoint&&summary?.bcs?.value&&checkpoint.digest===summary.digest&&typeof summary.epoch==='bigint'&&typeof summary.sequenceNumber==='bigint'
        &&checkpoint.sequenceNumber===summary.sequenceNumber&&checkpoint.signature?.epoch===summary.epoch&&checkpoint.signature.signature?.length===48&&checkpoint.signature.bitmap?.length,
      'Executed listing checkpoint evidence unavailable or inconsistent')
      return validateMarketCancelCheckpoint({bytes:toBase64(summary.bcs.value),digest:checkpoint.digest,epoch:String(summary.epoch),sequenceNumber:String(summary.sequenceNumber)},record.expirationEpoch)
    },
    async query(value){return (await queryMarketListOperationEvidence(value,client)).status},
  }
}

export type MarketListOperationEvidence = {status:'MISSING'|'PENDING'|'FAILED'} | {
  status:'SUCCEEDED';checkpoint:string;receipt:ReturnType<typeof ListedBcs.parse>;
  effects:ReturnType<typeof bcs.TransactionEffects.parse>;originalPackageId:string
}
/** Shared historical proof for query and browser post-success readback. */
export async function queryMarketListOperationEvidence(value:MarketListOperationRecord,client:SuiGrpcClient):Promise<MarketListOperationEvidence> {
      const record=validateMarketListOperationRecord(value),s=record.snapshot
      const proof=await queryListingPacketEvidence({...record,release:s.release},client)
      if(proof.status!=='SUCCEEDED')return proof
      const {events}=proof,packageId=s.release.soulidityCallablePackageId
      const matches=events.data.filter(event=>event.type_.address===s.release.soulidityOriginalPackageId&&event.type_.module==='market'&&event.type_.name==='SoulListed')
      check(matches.length===1,'Unique native listing event required')
      function authority(event:typeof matches[number],length:number){
        check(event.package_id===packageId&&event.transaction_module==='market'&&event.sender===s.owner
          &&event.type_.typeParams.length===0&&event.contents.length===length,'Native listing event authority mismatch')
      }
      const event=matches[0];authority(event,136)
      const receipt=ListedBcs.parse(Uint8Array.from(event.contents))
      check(toBase64(ListedBcs.serialize(receipt).toBytes())===toBase64(Uint8Array.from(event.contents))
        &&marketListId(receipt.listing_id)&&receipt.listing_id!==s.listingId
        &&receipt.soul_id===s.soulId&&receipt.seller===s.owner&&receipt.kiosk_id===s.kioskId&&receipt.price===record.priceAtomic,
        'Native listing receipt identity or price mismatch')
      const cancels=events.data.filter(event=>event.type_.address===s.release.soulidityOriginalPackageId&&event.type_.module==='market'&&event.type_.name==='SoulListingCancelled')
      if(record.kind==='reprice'){
        const cancelOrigins=proof.typeOrigins.filter(row=>row.moduleName==='market'&&row.datatypeName==='SoulListingCancelled')
        check(cancelOrigins.length===1&&cancelOrigins[0].packageId===s.release.soulidityOriginalPackageId&&cancels.length===1,
          'Unique old listing cancellation required')
        const old=cancels[0];authority(old,96)
        const cancel=CancelledBcs.parse(Uint8Array.from(old.contents))
        check(toBase64(CancelledBcs.serialize(cancel).toBytes())===toBase64(Uint8Array.from(old.contents))
          &&cancel.listing_id===s.listingId&&cancel.soul_id===s.soulId&&cancel.seller===s.owner
          &&events.data.indexOf(old)<events.data.indexOf(event),'Atomic reprice old cancellation mismatch')
      }else check(cancels.length===0,'A new listing cannot cancel another listing')
      return {status:'SUCCEEDED',checkpoint:proof.checkpoint,receipt,effects:proof.effects,originalPackageId:proof.originalPackageId}
}
