import { toBase64 } from '@mysten/sui/utils'
import { readHistoricalMoveObject, readHistoricalFailedSharedRoot, historicalObjectOutput } from '../../sui/historical-object'
import { readHistoricalParentTransaction, readHistoricalChildThroughParent } from '../../sui/historical-parent-lineage'
function check(v:unknown,code:string):asserts v{if(!v)throw Error(`APPLICATION_SHARED_HISTORY_${code}`)}
type Input=Omit<Parameters<typeof readHistoricalChildThroughParent>[0],'maxHops'> & {maxTotalHops?:number}
type Proof=Awaited<ReturnType<typeof readHistoricalChildThroughParent>>
/** Private continuation of an authenticated Shared parent snapshot. Progress
 * never proves absence, current authority, validator quorum or business output.
 * Original exclusive mutable parent and failed-payload checks remain mandatory. */
export async function createManagementSharedHistorySession(input:Input){
 const context={...input,anchorEffects:structuredClone(input.anchorEffects)},limit=input.maxTotalHops??1024
 check(Number.isSafeInteger(limit)&&limit>=1&&limit<=4096,'TOTAL_BOUND')
 check([context.rootId,context.parentUid,context.childId].every(id=>/^0x[0-9a-f]{64}$/.test(id)&&BigInt(id)!==0n)
  &&context.rootId!==context.childId&&context.parentUid!==context.childId,'ROLES')
 const lifecycle=new AbortController(),signal=AbortSignal.any([input.signal,lifecycle.signal])
 let root:Awaited<ReturnType<typeof readHistoricalMoveObject>>|null=null,checkpoint=context.anchorCheckpoint,bytes=0,busy=false,proof:Proof|null=null
 const seen=new Set<string>(),trail:Proof['trail']=[]
 const clear=()=>{root=null;proof=null;trail.length=0;seen.clear();bytes=0}
 signal.addEventListener('abort',clear,{once:true})
 try{root=await readHistoricalMoveObject({client:context.client,effects:context.anchorEffects,transactionDigest:context.anchorTransactionDigest,
  objectId:context.rootId,type:context.rootType,mode:context.anchorMode,signal:AbortSignal.any([signal,AbortSignal.timeout(60000)]),maxBytes:256*1024});signal.throwIfAborted()}
 catch(error){lifecycle.abort();throw error}
 return {
  progress:()=>({verifiedHops:trail.length,consumedRootBytes:bytes,complete:proof!==null,closed:signal.aborted}),
  dispose(){lifecycle.abort();clear()},
  async advance(options:{maxHops?:number}={}):Promise<{status:'INCOMPLETE';verifiedHops:number;completeBusinessOutputVerified:false}|{status:'PROVEN';proof:Proof;completeBusinessOutputVerified:false}>{
   signal.throwIfAborted();check(!busy,'SESSION_BUSY')
   const maxHops=options.maxHops??64;check(Number.isSafeInteger(maxHops)&&maxHops>=1&&maxHops<=256,'BOUND')
   if(proof)return {status:'PROVEN',proof:structuredClone(proof),completeBusinessOutputVerified:false}
   busy=true;const stepSignal=AbortSignal.any([signal,AbortSignal.timeout(60000)])
   try{for(let hop=0;hop<maxHops;hop++){
    stepSignal.throwIfAborted();check(root,'SESSION_CLOSED');check(trail.length<limit,'TOTAL_HOP_BOUND')
    const currentRoot=root,shared=currentRoot.object.owner.Shared,nextBytes=bytes+currentRoot.bytes.length
    check(shared,'SHARED_ROOT_REQUIRED');check(nextBytes<=16*1024*1024,'BYTE_BUDGET')
    context.assertContainsParent(new Uint8Array(currentRoot.bytes),context.parentUid)
    const previous=currentRoot.object.previousTransaction;check(!seen.has(previous),'TRANSACTION_CYCLE')
    const ancestor=await readHistoricalParentTransaction({client:context.client,transactionDigest:previous,maxCheckpoint:checkpoint,
     chainIdentifier:context.chainIdentifier,genesisDigest:context.genesisDigest,signal:stepSignal})
    const failed=ancestor.executionStatus==='Failure'
    const failedOutput=failed?await readHistoricalFailedSharedRoot({client:context.client,effects:ancestor.effects,transactionDigest:previous,
     objectId:context.rootId,type:context.rootType,mode:'mutated',signal:stepSignal,maxBytes:256*1024}):null
    const current=failedOutput?.reference??historicalObjectOutput(ancestor.effects,context.rootId)
    check(current.version===currentRoot.reference.version&&current.digest===currentRoot.reference.digest
     &&current.owner.Shared?.initialSharedVersion===shared.initialSharedVersion,'ROOT_LINK')
    if(current.created)check(!ancestor.sharedInputs.some(row=>row.objectId===context.rootId),'CREATED_ROOT_INPUT_ALIAS')
    else{const refs=ancestor.sharedInputs.filter(row=>row.objectId===context.rootId)
     check(refs.length===1&&refs[0].mutable===true&&String(refs[0].initialSharedVersion)===shared.initialSharedVersion,'EXCLUSIVE_ROOT_INPUT_REQUIRED')}
    const entry={rootVersion:String(current.version),transactionDigest:previous,checkpoint:ancestor.checkpoint,executionStatus:ancestor.executionStatus}
    const field=ancestor.effects.V2!.changedObjects.find(([id])=>id===context.childId)
    if(failed)check(!field,'FAILED_CHILD_CHANGE')
    if(field){
     check(field[1].outputState.$kind==='ObjectWrite','CHILD_ABSENT_OR_NOT_STORED')
     const child=await readHistoricalMoveObject({client:context.client,effects:ancestor.effects,transactionDigest:previous,
      objectId:context.childId,type:context.childType,mode:'written',signal:stepSignal,maxBytes:256*1024})
     check(child.object.owner.ObjectOwner===context.parentUid,'CHILD_PARENT');stepSignal.throwIfAborted()
     seen.add(previous);bytes=nextBytes;trail.push(entry)
     proof={proof:'original-child-through-shared-parent-lineage-only',rootId:context.rootId,parentUid:context.parentUid,childId:context.childId,
      bytes:new Uint8Array(child.bytes),reference:structuredClone(child.reference),writerTransactionDigest:previous,trail:structuredClone(trail),notCurrentAuthority:true,notBusinessReceipt:true}
     return {status:'PROVEN',proof:structuredClone(proof),completeBusinessOutputVerified:false}
    }
    check(!current.created,'CHILD_NOT_FOUND_AT_ROOT_CREATION')
    const prior=await(failed?readHistoricalFailedSharedRoot:readHistoricalMoveObject)({client:context.client,effects:ancestor.effects,transactionDigest:previous,
     objectId:context.rootId,type:context.rootType,mode:'input',signal:stepSignal,maxBytes:256*1024})
    if(failed)check(toBase64(prior.bytes)===toBase64(currentRoot.bytes)
     &&prior.object.data.Move?.hasPublicTransfer===currentRoot.object.data.Move?.hasPublicTransfer,'FAILED_ROOT_PAYLOAD_CHANGED')
    check(prior.reference.version<current.version&&prior.object.owner.Shared?.initialSharedVersion===shared.initialSharedVersion,'ROOT_INPUT_LINK')
    context.assertContainsParent(new Uint8Array(prior.bytes),context.parentUid);stepSignal.throwIfAborted()
    seen.add(previous);bytes=nextBytes;trail.push(entry);root=prior;checkpoint=ancestor.checkpoint
   }return {status:'INCOMPLETE',verifiedHops:trail.length,completeBusinessOutputVerified:false}}
   finally{busy=false}
  },
 }
}
