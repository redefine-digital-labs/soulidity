import { assertSameSoulForeignHeads, captureSameSoulHeadPort, createBrowserSameSoulHeadPort, SameSoulRecoveryRequired, type SameSoulMutationHeadPort } from './same-soul-mutation-heads'
import { captureSameSoulMutationClient } from './same-soul-mutation-client'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {publicMutationCanonical} from '../sui/public-mutation-journal'
import {withSoulAccessAssetLock,type SoulAccessAssetScope} from './soul-access-asset-lock'
import {browserSoulAccessStore,type SoulAccessStore} from './soul-access-store'
import {createSoulAccessAdapter,parseSoulAccessRecord} from './soul-access-operation'
import {soulAccessKey} from './soul-access-plan'
import {browserNativePublicReadPaidJournalV2,nativePublicReadPaidKeyV2,nativePublicReadPaidRecordFromOriginalV2,parseNativePublicReadPaidRecordV2,
 nativePublicReadPaidHeadCanClearV2,nativePublicReadPaidSettlementMatchesV2,queryNativePublicReadPaidRecordV2,discoverNativePublicReadPaidAssetV2,type NativePublicReadPaidJournalV2} from './native-public-read-paid-journal-v2'
import {preflightNewNativePublicReadPaidPurchaseV2} from './commerce/native-public-read-paid-preflight-v2'
import type {NativePublicReadPaidHostPreflightV2,NativePublicReadPaidHostRequestV2} from './commerce/native-public-read-paid-host-preflight-v2'
import {nativePublicReadPaidReviewIdentityV2} from './commerce/native-public-read-paid-read-v2'
import type {reviewNativePublicReadPaidInputsV2} from './commerce/native-public-read-paid-input-provider-v2'

export interface NativePublicReadPaidRecoveryV2 {
 format:'native-public-read-v2'|'soulidity.soul-access.v1'
 text:string;digest:string;soulId:string;durability:'CONFIRMED'|'UNCONFIRMED'
}
export class NativePublicReadPaidHostRecoveryErrorV2 extends Error {
 constructor(message:string,readonly recovery:NativePublicReadPaidRecoveryV2,options?:ErrorOptions){super(message,options);this.name='NativePublicReadPaidHostRecoveryErrorV2'}
}
const check=(value:unknown,code:string)=>{if(!value)throw Error(`NATIVE_PUBLIC_READ_PAID_HOST_V2_${code}`)}
/** Capture the actual RPC methods before the first await. Neither caller
 * mutation nor an async original parser may switch the transport mid-run. */
function clientSnapshot(source:SuiGrpcClient,signal:AbortSignal):SuiGrpcClient{return captureSameSoulMutationClient(source,signal)}

function requestSnapshot(input:NativePublicReadPaidHostRequestV2){
 const {qualification,getBuyerAddress,...rest}=input,{client,signal,...selection}=qualification
 return {...structuredClone(rest),qualification:{...structuredClone(selection),client:clientSnapshot(client,signal),signal:AbortSignal.any([signal,AbortSignal.timeout(90000)])},getBuyerAddress:getBuyerAddress.bind(input)}
}
function exposeLegacyRecovery(error:unknown,scope:SoulAccessAssetScope):never{
 if(!(error instanceof SameSoulRecoveryRequired)||!error.originalText||!error.key.startsWith('soulidity.soul-access:')||
  !['ORIGINAL_QUERY_UNAVAILABLE','TERMINAL_RESULT_UNCONFIRMED','ORIGINAL_RECOVERY_REQUIRED'].includes(error.reason))throw error
 let original:ReturnType<typeof parseSoulAccessRecord>
 try{original=parseSoulAccessRecord(JSON.parse(error.originalText))}catch{throw error}
 if(soulAccessKey(original.plan)!==error.key||original.plan.deployment.chainIdentifier!==scope.chainIdentifier||
  original.plan.soulId!==scope.soulId||original.plan.author!==scope.author)throw error
 const reason=error.reason==='ORIGINAL_QUERY_UNAVAILABLE'
  ? (error.cause instanceof Error?error.cause.message:'LEGACY_QUERY_FAILED')
  : (error.reason==='TERMINAL_RESULT_UNCONFIRMED'?'LEGACY_TERMINAL_RESULT_UNCONFIRMED':'LEGACY_RECOVERY_REQUIRED')
 throw new NativePublicReadPaidHostRecoveryErrorV2(reason,{format:'soulidity.soul-access.v1',text:error.originalText,
  digest:original.packet.digest,soulId:scope.soulId,durability:'CONFIRMED'},{cause:error})
}
/** Real unsigned Root HostFn: shared asset lock -> unique V2 journal head ->
 * exact original save/readback -> original-byte enabled simulation. No signer
 * or submitter is captured. Root still owns release/source/permission gates. */
export function createNativePublicReadPaidHostPreflightV2(options:{legacyStore?:SoulAccessStore;journal?:NativePublicReadPaidJournalV2;inputReviewer?:typeof reviewNativePublicReadPaidInputsV2;foreignHeads?:SameSoulMutationHeadPort}={}):NativePublicReadPaidHostPreflightV2{
 const inputReviewer=options.inputReviewer?.bind(options), suppliedHeads=options.foreignHeads?captureSameSoulHeadPort(options.foreignHeads):undefined
 return input=>{
  const request=requestSnapshot(input),q=request.qualification,scope={chainIdentifier:q.economics.chainIdentifier,soulId:q.soulId,author:q.buyer}
  const legacySource=options.legacyStore??(suppliedHeads?browserSoulAccessStore():null), journalSource=options.journal??browserNativePublicReadPaidJournalV2()
  const discoverLegacy=legacySource?.discoverAsset.bind(legacySource)
  const journal={exclusive:journalSource.exclusive.bind(journalSource),read:journalSource.read.bind(journalSource),write:journalSource.write.bind(journalSource),heads:journalSource.heads.bind(journalSource),history:journalSource.history.bind(journalSource)}
  const heads=suppliedHeads??createBrowserSameSoulHeadPort(q.client,undefined,q.signal)
  const guard=()=>{q.signal.throwIfAborted();check(request.getBuyerAddress()===q.buyer,'WALLET_CHANGED')}
  return withSoulAccessAssetLock(scope,async()=>{
   guard()
   const key=nativePublicReadPaidKeyV2(scope)
   return journal.exclusive(key,async()=>{
    guard()
    try{await assertSameSoulForeignHeads({scopes:[scope],ownKeys:[key],signal:q.signal,port:heads})}
    catch(error){guard();exposeLegacyRecovery(error,scope)}
    guard()
    // A separately injected legacy store can contain heads outside the shared port.
    for(const original of discoverLegacy?.(scope)??[]){
     const recovery:NativePublicReadPaidRecoveryV2={format:'soulidity.soul-access.v1',text:JSON.stringify(original),digest:original.packet.digest,soulId:scope.soulId,durability:'CONFIRMED'}
     try{
      const adapter=createSoulAccessAdapter({client:q.client,getAddress:request.getBuyerAddress,sign:async()=>{throw Error('UNSIGNED_HOST_SIGNING_DISABLED')}})
      const result=await adapter.query(original);guard()
      check(!['SUCCEEDED','FAILED'].includes(original.packet.phase)||result.status===original.packet.phase,'LEGACY_TERMINAL_RESULT_UNCONFIRMED')
      check(result.status==='FAILED'||original.packet.phase==='CANCELLED'&&original.packet.signature===null&&result.status==='MISSING','LEGACY_RECOVERY_REQUIRED')
     }catch(error){throw new NativePublicReadPaidHostRecoveryErrorV2(error instanceof Error?error.message:'LEGACY_QUERY_FAILED',recovery,{cause:error})}
    }
    let existing=(await discoverNativePublicReadPaidAssetV2(journal,scope))[0]??null
    const retention:{current:NativePublicReadPaidRecoveryV2|null}={current:null}
    if(existing){
     const recovery:NativePublicReadPaidRecoveryV2={format:'native-public-read-v2',text:existing.plan.originalText,digest:existing.packet.digest,soulId:scope.soulId,durability:'CONFIRMED'}
     try{
      const result=await queryNativePublicReadPaidRecordV2(existing,q.client,q.signal);guard()
      check(nativePublicReadPaidHeadCanClearV2(existing,result),'ORIGINAL_RECOVERY_REQUIRED')
      const phase=result.status==='FAILED'?'FAILED':nativePublicReadPaidSettlementMatchesV2(existing,result)?'SUCCEEDED':existing.packet.phase
      if(phase!==existing.packet.phase){
       const terminal=await parseNativePublicReadPaidRecordV2({...existing,packet:{...existing.packet,phase}})
       await journal.write(key,terminal);const readback=await journal.read(key)
       check(publicMutationCanonical(readback)===publicMutationCanonical(terminal),'PERSISTENCE_FAILED');existing=terminal
      }
     }catch(error){throw new NativePublicReadPaidHostRecoveryErrorV2(error instanceof Error?error.message:'ORIGINAL_QUERY_FAILED',recovery,{cause:error})}
    }
    guard()
    try{
     let reviewedRequest=request
     if(inputReviewer){
      // Original exclusion always precedes current quote/ABI/funding work.
      // The provider can refresh reviewed observations, never replace this
      // intent, selected resources, RPC methods or original transaction identity.
      const {client:_,signal:__,...selection}=q
      const {qualification:___,reviewed:____,getBuyerAddress:_____,...resources}=request
      const selectedIdentity=(value:{qualification:typeof selection}&typeof resources)=>{
       check(typeof value.qualification.requiredScope==='bigint','INPUT_REVIEW_SCOPE_TYPE')
       return publicMutationCanonical({...value,qualification:{...value.qualification,requiredScope:String(value.qualification.requiredScope)}})
      }
      const expected=selectedIdentity({...structuredClone(resources),qualification:structuredClone(selection)})
      const review=await inputReviewer({qualification:{...structuredClone(selection),client:clientSnapshot(q.client,q.signal),signal:q.signal},
       purchase:structuredClone(resources),getBuyerAddress:request.getBuyerAddress})
      guard()
      check(review.status==='PURCHASE_INPUTS_REVIEWED',review.status==='REUSE_CURRENT_ACCESS'?'CURRENT_ACCESS_REUSABLE':'INPUT_REVIEW_NOT_READY')
      if(review.status!=='PURCHASE_INPUTS_REVIEWED')throw Error('NATIVE_PUBLIC_READ_PAID_HOST_V2_INPUT_REVIEW_NOT_READY')
      const {reviewed:freshReviewed,...sameSelection}=review.preflightInput
      check(selectedIdentity(sameSelection)===expected,'INPUT_REVIEW_SELECTION_CHANGED')
      check(nativePublicReadPaidReviewIdentityV2(freshReviewed)===nativePublicReadPaidReviewIdentityV2(request.reviewed),'INPUT_REVIEW_QUOTE_CHANGED')
      reviewedRequest={...request,reviewed:structuredClone(freshReviewed)}
     }
     const preflight=await preflightNewNativePublicReadPaidPurchaseV2({...reviewedRequest,onPreparedOriginal:async original=>{
      // Producer JSON.stringify byte fields is the portable original format.
      // Save this exact text, never canonicalize/re-encode the inner original.
      const text=JSON.stringify(original),record=await nativePublicReadPaidRecordFromOriginalV2(text,scope.soulId)
      check(nativePublicReadPaidKeyV2(record.plan)===key,'PREPARATION_SCOPE')
      retention.current={format:'native-public-read-v2',text,digest:record.packet.digest,soulId:scope.soulId,durability:'UNCONFIRMED'}
      const previous=await journal.history(key),attempt=publicMutationCanonical(original.intent.attempt)
      if(existing)previous.unshift(existing)
      for(const prior of previous){
       check(prior.packet.digest!==record.packet.digest,'PREVIOUS_PACKET_REUSE')
       check(publicMutationCanonical(JSON.parse(prior.plan.originalText).intent.attempt)!==attempt,'PREVIOUS_ATTEMPT_REUSE')
      }
      guard();await journal.write(key,record)
      const readback=await journal.read(key)
      check(readback&&publicMutationCanonical(readback)===publicMutationCanonical(record)&&readback.plan.originalText===text,'PERSISTENCE_FAILED')
      retention.current={...retention.current,durability:'CONFIRMED'};guard()
     }})
     guard();const retained=retention.current
     if(!retained)throw Error('NATIVE_PUBLIC_READ_PAID_HOST_V2_ORIGINAL_NOT_RETAINED')
     return {preflight,retainedText:retained.text}
    }catch(error){
     const retained=retention.current
     if(retained)throw new NativePublicReadPaidHostRecoveryErrorV2(error instanceof Error?error.message:'PREFLIGHT_FAILED',retained,{cause:error})
     throw error
    }
   })
  })
 }
}
