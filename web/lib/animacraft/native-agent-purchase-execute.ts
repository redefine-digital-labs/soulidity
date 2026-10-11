import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { quoteAnimacraftV8SoulSale } from '@soulidity/sdk'
import { createNativeAgentPurchaseServices } from './native-agent-purchase-services'
import { marketBuyCanonical, validateMarketBuyOperationRecord, type MarketBuyOperationRecord } from './market-buy-operation'
import { validateMarketCancelCheckpoint } from './market-cancel-checkpoint'
import { NativeReceiveError } from './native-receive'
import { verifyNativePurchase } from './native-purchase-verifier'
import { syncSoulProjectionFromChain, endActiveSoulGrantProjectionsFromChain } from '@/lib/soulidity/mirror/sync-helpers'

interface PreparedNativePurchase {
  id:string;agentMemberId:string;soulOnChainId:string;listingObjectId:string;sellerKioskId:string;agentAddress:string
  priceAtomic:{toString():string};totalAtomic:{toString():string};platformFeeAtomic:{toString():string};creatorRoyaltyAtomic:{toString():string}
  txBytesBase64:string;txBytesHash:string;nativeOperation?:unknown;operationRevision?:number;executionTxDigest?:string|null
}
interface NativePurchaseSoul {
  onChainId:string;stateOnChainId:string;provenanceKind?:string|null
  tags:string[];previewImages:string[];readme:string|null;creatorMemberId:string|null
}
class NativeExecuteError extends Error {
  constructor(readonly code:string,readonly status:number,message:string){super(message)}
}
const fail=(code:string,status:number,message:string):never=>{throw new NativeExecuteError(code,status,message)}
async function bounded<T>(work:()=>PromiseLike<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([Promise.resolve().then(work),new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error('Native purchase persistence timed out; check the saved packet')),25_000)
  })])}finally{clearTimeout(timer)}
}
/** External agents can sign as soon as bytes are returned. No wall-clock TTL,
 * unsigned deletion, replacement bytes or legacy receipt fallback is safe here. */
export async function executeNativeAgentPurchase(input:{
  request:Request;body:Record<string,unknown>|null;prepared:PreparedNativePurchase;soul:NativePurchaseSoul
  agentMemberId:string;walletAddresses:string[]
}):Promise<NextResponse>{
  const {request,agentMemberId}=input
  const prepared=input.prepared
  const soul=structuredClone(input.soul)
  const action=input.body?.action??'execute'
  const supplied=input.body?.signature
  const signature=typeof supplied==='string'?supplied.trim():null
  let record:MarketBuyOperationRecord|undefined
  let revision=prepared.operationRevision
  let finalized=false
  const respond=(body:Record<string,unknown>,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})
  try{
    if(!['check','execute','retire'].includes(action as string)||supplied!=null&&(!signature||signature.length>=32768))
      fail('NATIVE_PURCHASE_ACTION_INVALID',400,'Use check, execute or retire with an optional valid signature')
    if(prepared.agentMemberId!==agentMemberId)fail('NATIVE_PURCHASE_SCOPE_MISMATCH',403,'Prepared purchase belongs to another agent')
    if(prepared.nativeOperation==null)fail('NATIVE_PURCHASE_PACKET_REQUIRED',422,'A native prepared purchase packet is required')
    try{record=validateMarketBuyOperationRecord(prepared.nativeOperation)}catch{fail('NATIVE_PREPARED_PURCHASE_INVALID',422,'Invalid native purchase packet')}
    const s=record!.snapshot
    const quote=quoteAnimacraftV8SoulSale(BigInt(s.priceAtomic),s)
    if(!Number.isSafeInteger(revision)||revision!<0||prepared.soulOnChainId!==soul.onChainId||s.soulId!==soul.onChainId
      ||s.stateId!==soul.stateOnChainId||prepared.agentAddress!==s.buyer||!input.walletAddresses.includes(s.buyer)
      ||prepared.listingObjectId!==s.listingId||prepared.sellerKioskId!==s.sellerKioskId
      ||prepared.priceAtomic.toString()!==s.priceAtomic||prepared.totalAtomic.toString()!==s.priceAtomic
      ||prepared.platformFeeAtomic.toString()!==String(quote.protocolFeeAtomic)
      ||prepared.creatorRoyaltyAtomic.toString()!==String(quote.soulCreatorRoyaltyAtomic)
      ||prepared.txBytesBase64!==record!.bytes
      ||prepared.txBytesHash!==createHash('sha256').update(Buffer.from(record!.bytes,'base64')).digest('hex')
      ||prepared.executionTxDigest!=null&&prepared.executionTxDigest!==record!.digest)
      fail('NATIVE_PREPARED_PURCHASE_INVALID',422,'Prepared purchase columns do not match its exact Soul, buyer and packet')
    if(record!.signature!==null&&signature!==null&&signature!==record!.signature)
      fail('NATIVE_PURCHASE_SIGNATURE_CHANGED',422,'A saved signature cannot be replaced')
    const id=prepared.id
    const save=async(next:MarketBuyOperationRecord)=>{
      const valid=validateMarketBuyOperationRecord(next)
      if(valid.bytes!==record!.bytes||valid.digest!==record!.digest||marketBuyCanonical(valid.snapshot)!==marketBuyCanonical(record!.snapshot))
        fail('NATIVE_PREPARED_PURCHASE_INVALID',422,'Prepared purchase packet identity changed')
      request.signal.throwIfAborted()
      const result=await bounded(()=>prisma.soulPreparedPurchase.updateMany({
        where:{id,operationRevision:revision,nativeOperation:{equals:record as never}},
        data:{nativeOperation:valid as never,operationRevision:{increment:1},executionTxDigest:valid.digest,
          ...(valid.phase==='SUCCEEDED'||valid.phase==='FAILED'?{executedAt:new Date()}:{}),
          resultBody:undefined,resultStatusCode:undefined},
      }))
      if(result.count!==1)fail('NATIVE_PURCHASE_OPERATION_CONFLICT',409,'Purchase changed concurrently; check its saved packet')
      const readback=await bounded(()=>prisma.soulPreparedPurchase.findUnique({where:{id}}))
      if(!readback||readback.operationRevision!==revision!+1||readback.executionTxDigest!==valid.digest
        ||marketBuyCanonical(readback.nativeOperation)!==marketBuyCanonical(valid))
        fail('NATIVE_PURCHASE_OPERATION_CONFLICT',409,'Purchase persistence could not be confirmed; check its saved packet')
      revision=readback!.operationRevision;record=valid
      request.signal.throwIfAborted()
    }
    // This projection is used only after adapter.query proved every corresponding
    // canonical native event field and floor payout against this exact packet.
    const sync=async(verified:MarketBuyOperationRecord):Promise<'COMPLETE'|'SUPERSEDED'>=>{
      const snapshot=verified.snapshot
      const q=quoteAnimacraftV8SoulSale(BigInt(snapshot.priceAtomic),snapshot)
      const purchase={listingId:snapshot.listingId,soulId:snapshot.soulId,provenanceId:snapshot.bindingId,
        sellerAddress:snapshot.seller,buyerAddress:snapshot.buyer,makerSourceRecipientAddress:snapshot.makerCreator,
        priceAtomic:BigInt(snapshot.priceAtomic),sellerPayoutAtomic:q.sellerPayoutAtomic,protocolFeeAtomic:q.protocolFeeAtomic,
        soulCreatorRoyaltyBps:snapshot.soulCreatorRoyaltyBps,soulCreatorRoyaltyAtomic:q.soulCreatorRoyaltyAtomic,
        makerSourceRoyaltyBps:snapshot.makerSourceRoyaltyBps,makerSourceRoyaltyAtomic:q.makerSourceRoyaltyAtomic}
      const signal=AbortSignal.any([request.signal,AbortSignal.timeout(25_000)])
      try{
        const expectedNativeHeldState=await verifyNativePurchase(soul.onChainId,soul.stateOnChainId,purchase,
          snapshot.release.soulidityOriginalPackageId,signal)
        signal.throwIfAborted()
        const mirrored=await syncSoulProjectionFromChain({packageId:snapshot.release.soulidityOriginalPackageId,
          soulObjectId:soul.onChainId,stateObjectId:soul.stateOnChainId,tags:soul.tags,previewImages:soul.previewImages,
          readme:soul.readme,creatorMemberId:soul.creatorMemberId,currentOwnerMemberId:agentMemberId,
          listingObjectOnChainId:null,listedPriceAtomic:null,listingStatus:'held',expectedNativeHeldState})
        signal.throwIfAborted()
        await endActiveSoulGrantProjectionsFromChain({soulOnChainId:mirrored.onChainId,status:'invalidated'})
        signal.throwIfAborted()
        return 'COMPLETE'
      }catch(error){
        if(error instanceof NativeReceiveError&&error.code==='NATIVE_PURCHASE_OWNER_CHANGED'&&error.status===409)return 'SUPERSEDED'
        throw error
      }
    }
    const {adapter}=createNativeAgentPurchaseServices({soulId:s.soulId,stateId:s.stateId,listingId:s.listingId,buyer:s.buyer},request.signal,undefined,sync)
    const query=async()=>{
      const status=await adapter.query(structuredClone(record!))
      if(!['MISSING','PENDING','SUCCEEDED','FAILED'].includes(status))throw new Error('Invalid native purchase query result')
      return status
    }
    const reconcile=async(status:Awaited<ReturnType<typeof query>>):Promise<NextResponse|null>=>{
      if(status==='SUCCEEDED'){
        finalized=true
        await save({...record!,phase:'SUCCEEDED',syncStatus:'PENDING'})
        const syncStatus=await adapter.sync(structuredClone(record!))
        if(syncStatus!=='COMPLETE'&&syncStatus!=='SUPERSEDED')throw new Error('Invalid native purchase sync result')
        await save({...record!,syncStatus})
        return respond({digest:record!.digest,soulOnChainId:s.soulId,phase:'SUCCEEDED',outcome:'SUCCEEDED',onChainSuccess:true,
          dbSynced:syncStatus==='COMPLETE',syncStatus,
          ...(syncStatus==='COMPLETE'?{currentOwnerAddress:s.buyer,listingStatus:'held',paidAtomic:s.priceAtomic,totalAtomic:s.priceAtomic}
            :{code:'NATIVE_PURCHASE_OWNER_CHANGED',error:'The purchase succeeded, but the Soul is no longer held by this buyer'})},syncStatus==='COMPLETE'?200:409)
      }
      if(status==='FAILED'){
        await save({...record!,phase:'FAILED',syncStatus:undefined})
        return respond({code:'NATIVE_PURCHASE_TRANSACTION_FAILED',digest:record!.digest,phase:'FAILED',outcome:'FAILED',onChainSuccess:false},422)
      }
      if(record!.phase==='SUCCEEDED'||record!.phase==='FAILED')throw new Error('Saved purchase outcome cannot be confirmed')
      return null
    }
    const first=await query()
    const result=await reconcile(first);if(result)return result
    if(first==='PENDING'||action==='check')return respond({digest:record!.digest,phase:record!.phase,outcome:first,recoverable:true},202)
    if(action==='retire'){
      if(!['PREPARED','SIGNING','SIGNED'].includes(record!.phase))
        fail('NATIVE_PURCHASE_RETRY_UNAVAILABLE',409,'This packet cannot be retired again')
      const checkpoint=validateMarketCancelCheckpoint(await adapter.expiryCheckpoint(structuredClone(record!)),record!.expirationEpoch)
      await save({...record!,phase:'RETIRED',retirement:{priorPhase:record!.phase==='SIGNED'?'SIGNED':'SIGNING',checkpoint}})
      return respond({digest:record!.digest,phase:'RETIRED',outcome:'UNKNOWN',recoverable:true})
    }
    if(!['PREPARED','SIGNING','SIGNED'].includes(record!.phase))
      fail('NATIVE_PURCHASE_RETRY_UNAVAILABLE',409,'This packet is query-only and cannot be broadcast')
    if(record!.signature===null){
      if(!signature)fail('NATIVE_PURCHASE_SIGNATURE_REQUIRED',400,'A signature for the exact prepared bytes is required')
      const signed=validateMarketBuyOperationRecord({...record!,phase:'SIGNED',signature})
      await adapter.verifySignature(signed)
      await adapter.preflight(structuredClone(record!),true)
      await save(signed)
    }else{
      await adapter.verifySignature(structuredClone(record!))
      await adapter.preflight(structuredClone(record!),false)
      // Claim this attempt by CAS even for same-signature retries.
      await save({...record!})
    }
    request.signal.throwIfAborted()
    await adapter.broadcast(structuredClone(record!))
    const after=await query()
    return await reconcile(after)??respond({digest:record!.digest,phase:record!.phase,outcome:after,recoverable:true},202)
  }catch(error){
    if(error instanceof NativeExecuteError)return respond({code:error.code,error:error.message,...(record?{digest:record.digest,phase:record.phase}:{}),recoverable:error.status===409},error.status)
    // A preflight expiration is unavailability, never chain failure. The caller
    // can still check or explicitly retire using executed-checkpoint evidence.
    if(error instanceof Error&&error.message==='Saved purchase expired; query or retire without rebuilding it')
      return respond({code:'NATIVE_PURCHASE_RETRY_UNAVAILABLE',digest:record?.digest,phase:record?.phase,recoverable:true},409)
    return respond({code:'NATIVE_PURCHASE_RECOVERY_REQUIRED',digest:record?.digest,phase:record?.phase,recoverable:true,
      ...(finalized?{onChainSuccess:true,dbSynced:false}:{} )},finalized?207:503)
  }
}
