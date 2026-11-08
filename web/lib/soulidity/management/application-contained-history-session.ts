import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { readHistoricalMoveObject, historicalObjectOutput } from '../../sui/historical-object'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
function check(v:unknown,code:string):asserts v{if(!v)throw Error(`APPLICATION_CONTAINED_HISTORY_${code}`)}
export type ManagementContainedHistoryInput={
 client:SuiGrpcClient;anchorEffects:ReturnType<typeof bcs.TransactionEffects.parse>;anchorTransactionDigest:string;anchorCheckpoint:string
 anchorMode?:'input'|'written';rootId:string;rootType:string;rootOwnerId:string;parentUid:string;childId:string;childType:string
 chainIdentifier:string;genesisDigest:string;signal:AbortSignal;assertContainsParent:(bytes:Uint8Array,parentUid:string)=>void
}
type Trail=Array<{version:string;transactionDigest:string;checkpoint:string}>
type Proof={bytes:Uint8Array;reference:Awaited<ReturnType<typeof readHistoricalMoveObject>>['reference'];writerTransactionDigest:string;trail:Trail;requiresQualifiedParentCommitInvariant:true;notRecursiveTreeProof:true}
/** Private in-memory continuation of one authenticated original anchor. No
 * serialized cursor/proof is accepted. Caller still authenticates root/tree and
 * qualifies the parent-commit invariant. Progress is not a business receipt. */
export async function createManagementContainedHistorySession(input:ManagementContainedHistoryInput & {maxTotalHops?:number}){
 const context={...input,anchorEffects:structuredClone(input.anchorEffects)},maxTotalHops=input.maxTotalHops??1024
 check(Number.isSafeInteger(maxTotalHops)&&maxTotalHops>=1&&maxTotalHops<=4096,'TOTAL_BOUND')
 check([context.rootId,context.rootOwnerId,context.parentUid,context.childId].every(id=>/^0x[0-9a-f]{64}$/.test(id)&&!/^0x0+$/.test(id))
  &&new Set([context.rootId,context.rootOwnerId,context.parentUid,context.childId]).size===4,'ROLES')
 const lifecycle=new AbortController(),signal=AbortSignal.any([context.signal,lifecycle.signal])
 let root:Awaited<ReturnType<typeof readHistoricalMoveObject>>|null=null,checkpoint=context.anchorCheckpoint,bytes=0,busy=false,proof:Proof|null=null
 const seen=new Set<string>(),trail:Trail=[]
 const clear=()=>{root=null;proof=null;trail.length=0;seen.clear();bytes=0}
 signal.addEventListener('abort',clear,{once:true})
 try{root=await readHistoricalMoveObject({client:context.client,effects:context.anchorEffects,transactionDigest:context.anchorTransactionDigest,
  objectId:context.rootId,type:context.rootType,mode:context.anchorMode??'input',signal:AbortSignal.any([signal,AbortSignal.timeout(60000)]),maxBytes:256*1024});signal.throwIfAborted()}
 catch(error){lifecycle.abort();throw error}
 return {
  progress:()=>({verifiedHops:trail.length,consumedRootBytes:bytes,complete:proof!==null,closed:signal.aborted}),
  dispose(){lifecycle.abort();clear()},
  async advance(options:{maxHops?:number}={}):Promise<{status:'INCOMPLETE';verifiedHops:number;completeBusinessOutputVerified:false}|{status:'PROVEN';proof:Proof;completeBusinessOutputVerified:false}>{
   signal.throwIfAborted();check(!busy,'SESSION_BUSY')
   const maxHops=options.maxHops??64;check(Number.isSafeInteger(maxHops)&&maxHops>=1&&maxHops<=256,'BOUND')
   if(proof)return {status:'PROVEN',proof:structuredClone(proof),completeBusinessOutputVerified:false}
   busy=true
   const stepSignal=AbortSignal.any([signal,AbortSignal.timeout(60000)])
   try{
    for(let hop=0;hop<maxHops;hop++){
     stepSignal.throwIfAborted();check(root,'SESSION_CLOSED');check(trail.length<maxTotalHops,'TOTAL_HOP_BOUND')
     const current=root,nextBytes=bytes+current.bytes.length;check(nextBytes<=16*1024*1024,'BYTE_BOUND')
     check(current.object.owner.ObjectOwner===context.rootOwnerId,'OWNER');context.assertContainsParent(new Uint8Array(current.bytes),context.parentUid)
     const previous=current.object.previousTransaction;check(!seen.has(previous),'CYCLE')
     const ancestor=await readHistoricalParentTransaction({client:context.client,transactionDigest:previous,maxCheckpoint:checkpoint,
      chainIdentifier:context.chainIdentifier,genesisDigest:context.genesisDigest,signal:stepSignal})
     check(ancestor.executionStatus==='Success','UNSUPPORTED_FAILURE')
     const ref=historicalObjectOutput(ancestor.effects,context.rootId)
     check(ref.version===current.reference.version&&ref.digest===current.reference.digest&&ref.owner.ObjectOwner===context.rootOwnerId
      &&!ancestor.sharedInputs.some(row=>row.objectId===context.rootId),'ROOT_LINK')
     const entry={version:String(ref.version),transactionDigest:previous,checkpoint:ancestor.checkpoint}
     if(ancestor.effects.V2!.changedObjects.some(([id])=>id===context.childId)){
      const child=await readHistoricalMoveObject({client:context.client,effects:ancestor.effects,transactionDigest:previous,
       objectId:context.childId,type:context.childType,mode:'written',signal:stepSignal,maxBytes:256*1024})
      check(child.object.owner.ObjectOwner===context.parentUid,'CHILD_OWNER');stepSignal.throwIfAborted()
      seen.add(previous);bytes=nextBytes;trail.push(entry)
      proof={bytes:new Uint8Array(child.bytes),reference:structuredClone(child.reference),writerTransactionDigest:previous,trail:structuredClone(trail),
       requiresQualifiedParentCommitInvariant:true,notRecursiveTreeProof:true}
      return {status:'PROVEN',proof:structuredClone(proof),completeBusinessOutputVerified:false}
     }
     check(!ref.created&&ref.inputOwner?.ObjectOwner===context.rootOwnerId,'MISSING_AT_CREATION_OR_REBOUND')
     const prior=await readHistoricalMoveObject({client:context.client,effects:ancestor.effects,transactionDigest:previous,
      objectId:context.rootId,type:context.rootType,mode:'input',signal:stepSignal,maxBytes:256*1024})
     check(prior.reference.version<ref.version&&prior.object.owner.ObjectOwner===context.rootOwnerId,'PRIOR_LINK')
     context.assertContainsParent(new Uint8Array(prior.bytes),context.parentUid);stepSignal.throwIfAborted()
     // Commit only a fully checked boundary. A failed RPC can retry this same step.
     seen.add(previous);bytes=nextBytes;trail.push(entry);root=prior;checkpoint=ancestor.checkpoint
    }
    return {status:'INCOMPLETE',verifiedHops:trail.length,completeBusinessOutputVerified:false}
   }finally{busy=false}
  },
 }
}
