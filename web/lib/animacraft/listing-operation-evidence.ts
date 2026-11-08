import {bcs} from '@mysten/sui/bcs'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {toBase58,toBase64} from '@mysten/sui/utils'
import {blake2b} from '@noble/hashes/blake2.js'
import {MAINNET_GENESIS_DIGEST} from './mainnet-chain'
import {marketListCheck as check} from './market-list-operation'
import type {NativeMarketListSnapshot} from './market-list-types'
import {authenticatePinnedMovePackageObject} from '../sui/pinned-move-package'
import {readActivityCheckpointEvidence} from '../soulidity/activity-transaction-evidence'
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
  checkpointProof?:Awaited<ReturnType<typeof assertListingEffectsCheckpoint>>
}
export type ListingPacketPackagePin={originalPackageId:string;callablePackageId:string;callableDigest:string}
export type ListingPacketEventOrigin={moduleName:string;datatypeName:string;packageId:string}
export async function assertListingEffectsCheckpoint(input:{
  client:SuiGrpcClient;effects:ReturnType<typeof bcs.TransactionEffects.parse>;checkpoint:string;transactionDigest:string;signal:AbortSignal
},message='Listing effects missing from original checkpoint'){
  const {client,effects,checkpoint,transactionDigest,signal}=input
  const executedEpoch=effects.V2?.executedEpoch??effects.V1?.executedEpoch
  const membership=await readActivityCheckpointEvidence({client,signal,chainIdentifier:'35834a8a',checkpoint})
  const bytes=bcs.TransactionEffects.serialize(effects).toBytes()
  const prefix=new TextEncoder().encode('TransactionEffects::'),preimage=new Uint8Array(prefix.length+bytes.length)
  preimage.set(prefix);preimage.set(bytes,prefix.length)
  const effectsDigest=toBase58(blake2b(preimage,{dkLen:32}))
  const rows=membership.transactions.filter(row=>row.transactionDigest===transactionDigest)
  check(membership.epoch===executedEpoch&&rows.length===1&&rows[0].effectsDigest===effectsDigest,message)
  return {checkpoint,digest:membership.digest,effectsDigest}
}
async function readListingPackageOrigins(client:SuiGrpcClient,pin:ListingPacketPackagePin){
  const packageId=pin.callablePackageId
  const {response}=await bounded(abort=>client.ledgerService.getObject({objectId:packageId,
    readMask:{paths:['object_id','version','digest','owner','package','bcs']}},{abort,timeout:TIMEOUT_MS}))
  const object=structuredClone(response.object),pkg=object?.package
  check(object?.objectId===packageId&&typeof object.version==='bigint'&&object.version>0n
    &&object.digest===pin.callableDigest&&object.owner?.kind===4
    &&(pkg?.storageId===undefined||pkg.storageId===packageId)
    &&(pkg?.version===undefined||pkg.version===object.version)
    &&(pkg?.originalId===undefined||pkg.originalId===pin.originalPackageId),'Listing historical package mismatch')
  const complete=pkg?.storageId!==undefined&&pkg.version!==undefined&&pkg.originalId!==undefined
  if(complete&&!object.bcs?.value)return pkg.typeOrigins

  const raw=authenticatePinnedMovePackageObject(object,pin)
  if(raw.version===1n){
    check(pin.originalPackageId===packageId,'Listing initial package identity mismatch')
  }else if(pkg?.originalId===undefined){
    // The original family of an upgraded package is separate from a type's
    // defining package. Resolve it at the exact immutable storage ID.
    const {response:lookup}=await bounded(abort=>client.movePackageService.getPackage(
      {packageId},{abort,timeout:TIMEOUT_MS}))
    check(lookup.package?.storageId===packageId&&lookup.package.version===raw.version
      &&lookup.package.originalId===pin.originalPackageId,'Listing original package family mismatch')
  }
  const supplied=new Set<string>()
  for(const origin of pkg?.typeOrigins??[]){
    const key=`${origin.moduleName}::${origin.datatypeName}`
    check(!supplied.has(key)&&raw.origins.has(key)&&raw.origins.get(key)===origin.packageId,'Native listing event origin mismatch')
    supplied.add(key)
  }
  return [...raw.origins].map(([key,packageId])=>{
    const [moduleName,datatypeName]=key.split('::')
    return {moduleName,datatypeName,packageId}
  })
}
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
  requiredEventOrigins:readonly ListingPacketEventOrigin[];
  executionWindow?:{min:string;max:string;addressGas:boolean};verifyCheckpoint?:true},client:SuiGrpcClient):Promise<ListingPacketEvidence>{
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
      const bytes=found.effects.bcs.value
      if(record.executionWindow)check(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=1024*1024,'Equipment effects bytes unavailable or oversized')
      const decoded=bcs.TransactionEffects.parse(bytes)
      check(toBase64(bcs.TransactionEffects.serialize(decoded).toBytes())===toBase64(bytes),'Noncanonical listing effects')
      const effects=decoded.V2??decoded.V1
      check(effects?.transactionDigest===record.digest&&['Success','Failure'].includes(effects.status.$kind)
        &&found.effects.status?.success===(effects.status.$kind==='Success'),'Listing transaction status mismatch')
      if(record.executionWindow){
        const window=record.executionWindow,epoch=BigInt(effects.executedEpoch)
        check(epoch>=BigInt(window.min)&&epoch<=BigInt(window.max)&&(!window.addressGas||decoded.V2),'Listing executed outside its gas epoch window')
      }
      if(found.checkpoint===undefined)return {status:'PENDING'};check(found.checkpoint>=0n,'Invalid listing checkpoint')
      const checkpoint=String(found.checkpoint)
      const checkpointProof=record.verifyCheckpoint?await bounded(signal=>assertListingEffectsCheckpoint({
        client,signal,effects:decoded,checkpoint,transactionDigest:record.digest,
      })):undefined
      if(effects.status.$kind==='Failure')return {status:'FAILED'}
      check(record.requiredEventOrigins.length>0,'Listing event origins required')
      const typeOrigins=await readListingPackageOrigins(client,pin)
      for(const required of record.requiredEventOrigins){
        const origins=typeOrigins.filter(row=>row.moduleName===required.moduleName&&row.datatypeName===required.datatypeName)
        check(origins.length===1&&origins[0].packageId===required.packageId,'Native listing event origin mismatch')
      }
      const eventBytes=found.events?.bcs?.value
      check(eventBytes&&eventBytes.length<=65_536,'Native listing event evidence unavailable')
      const events=EventsBcs.parse(eventBytes);const prefix=new TextEncoder().encode('TransactionEvents::')
      const hash=toBase58(blake2b(new Uint8Array([...prefix,...eventBytes]),{dkLen:32}))
      check(toBase64(EventsBcs.serialize(events).toBytes())===toBase64(eventBytes)&&found.events?.digest===hash&&effects.eventsDigest===hash,
        'Native listing events digest mismatch')

  return {status:'SUCCEEDED',checkpoint,effects:decoded,events,originalPackageId:pin.originalPackageId,typeOrigins,
    ...(checkpointProof?{checkpointProof}:{})}
}
