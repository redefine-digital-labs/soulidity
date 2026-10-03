import {bcs} from '@mysten/sui/bcs'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {toBase58,toBase64} from '@mysten/sui/utils'
import {blake2b} from '@noble/hashes/blake2.js'
import {MAINNET_GENESIS_DIGEST} from './mainnet-chain'
import {marketListCheck as check} from './market-list-operation'
import type {NativeMarketListSnapshot} from './market-list-types'
const TIMEOUT_MS=25_000
async function bounded<T>(work:(signal:AbortSignal)=>PromiseLike<T>):Promise<T>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new Error('Listing proof timed out; query the saved transaction'))},TIMEOUT_MS)
  })])}finally{clearTimeout(timer)}
}
const EventBcs=bcs.struct('Event',{package_id:bcs.Address,transaction_module:bcs.string(),sender:bcs.Address,type_:bcs.StructTag,contents:bcs.vector(bcs.u8())})
const EventsBcs=bcs.struct('TransactionEvents',{data:bcs.vector(EventBcs)})
export type ListingPacketEvidence={status:'MISSING'|'PENDING'|'FAILED'}|{
  status:'SUCCEEDED';checkpoint:string;effects:ReturnType<typeof bcs.TransactionEffects.parse>;
  events:ReturnType<typeof EventsBcs.parse>;originalPackageId:string;typeOrigins:Array<{moduleName?:string;datatypeName?:string;packageId?:string}>
}
export type ListingPacketPackagePin={originalPackageId:string;callablePackageId:string;callableDigest:string}
export type ListingPacketEventOrigin={moduleName:string;datatypeName:string;packageId:string}
/** Call only after the concrete single/batch command graph validator. Evidence
 * authenticates saved bytes, effects, the historical package and entire event BCS. */
export async function queryListingPacketEvidence(value:{bytes:string;digest:string;release:NativeMarketListSnapshot['release']},
  client:SuiGrpcClient):Promise<ListingPacketEvidence>{
  return queryExactListingPacketEvidence({bytes:value.bytes,digest:value.digest,packagePin:{
    originalPackageId:value.release.soulidityOriginalPackageId,callablePackageId:value.release.soulidityCallablePackageId,
    callableDigest:value.release.soulidityCallableDigest},requiredEventOrigins:[{
      moduleName:'market',datatypeName:'SoulListed',packageId:value.release.soulidityOriginalPackageId}]},client)
}
/** Authenticates packet-level evidence against saved package pins, without live
 * asset reads. Callers validate the command graph and concrete event receipts;
 * requiredEventOrigins authenticates their historical datatype origins. */
export async function queryExactListingPacketEvidence(value:{bytes:string;digest:string;packagePin:ListingPacketPackagePin;
  requiredEventOrigins:readonly ListingPacketEventOrigin[]},client:SuiGrpcClient):Promise<ListingPacketEvidence>{
      const record=structuredClone(value);const pin=record.packagePin;const {response:service}=await bounded(abort=>client.ledgerService.getServiceInfo({}, {abort,timeout:TIMEOUT_MS}));check(service.chainId===MAINNET_GENESIS_DIGEST,'Mainnet list RPC required');let response
      try{response=(await bounded(abort=>client.ledgerService.getTransaction({digest:record.digest,readMask:{paths:[
        'digest','transaction.digest','transaction.bcs','effects.bcs','effects.transaction_digest','effects.status','checkpoint','events',
      ]}},{abort,timeout:TIMEOUT_MS}))).response}catch(error){
        if(error&&typeof error==='object'&&'code'in error&&error.code==='NOT_FOUND')return {status:'MISSING'};throw error
      }
      const found=structuredClone(response.transaction)
      check(found?.digest===record.digest&&found.transaction?.digest===record.digest&&found.transaction.bcs?.value
        &&toBase64(found.transaction.bcs.value)===record.bytes&&found.effects?.transactionDigest===record.digest&&found.effects.bcs?.value,
      'Listing transaction evidence mismatch')
      const bytes=found.effects.bcs.value;const decoded=bcs.TransactionEffects.parse(bytes)
      check(toBase64(bcs.TransactionEffects.serialize(decoded).toBytes())===toBase64(bytes),'Noncanonical listing effects')
      const effects=decoded.V2??decoded.V1
      check(effects?.transactionDigest===record.digest&&['Success','Failure'].includes(effects.status.$kind)
        &&found.effects.status?.success===(effects.status.$kind==='Success'),'Listing transaction status mismatch')
      if(found.checkpoint===undefined)return {status:'PENDING'};check(found.checkpoint>=0n,'Invalid listing checkpoint')
      if(effects.status.$kind==='Failure')return {status:'FAILED'}
      const packageId=pin.callablePackageId
      const {response:packageResponse}=await bounded(abort=>client.ledgerService.getObject({objectId:packageId,
        readMask:{paths:['object_id','version','digest','owner','package']}},{abort,timeout:TIMEOUT_MS}))
      const object=packageResponse.object;const pkg=object?.package
      check(object?.objectId===packageId&&typeof object.version==='bigint'&&object.version>0n
        &&object.digest===pin.callableDigest&&object.owner?.kind===4
        &&pkg?.storageId===packageId&&pkg.version===object.version&&pkg.originalId===pin.originalPackageId,'Listing historical package mismatch')
      check(record.requiredEventOrigins.length>0,'Listing event origins required')
      for(const required of record.requiredEventOrigins){
        const origins=pkg.typeOrigins.filter(row=>row.moduleName===required.moduleName&&row.datatypeName===required.datatypeName)
        check(origins.length===1&&origins[0].packageId===required.packageId,'Native listing event origin mismatch')
      }
      const eventBytes=found.events?.bcs?.value
      check(eventBytes&&eventBytes.length<=65_536,'Native listing event evidence unavailable')
      const events=EventsBcs.parse(eventBytes);const prefix=new TextEncoder().encode('TransactionEvents::')
      const hash=toBase58(blake2b(new Uint8Array([...prefix,...eventBytes]),{dkLen:32}))
      check(toBase64(EventsBcs.serialize(events).toBytes())===toBase64(eventBytes)&&found.events?.digest===hash&&effects.eventsDigest===hash,
        'Native listing events digest mismatch')

  return {status:'SUCCEEDED',checkpoint:String(found.checkpoint),effects:decoded,events,originalPackageId:pkg.originalId,typeOrigins:pkg.typeOrigins}
}
