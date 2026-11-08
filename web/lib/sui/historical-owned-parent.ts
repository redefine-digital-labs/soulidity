import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { readHistoricalMoveObject, historicalObjectOutput } from './historical-object'
import { readHistoricalParentTransaction } from './historical-parent-lineage'

function check(v:unknown,code:string):asserts v {if(!v)throw Error(`HISTORICAL_OWNED_PARENT_${code}`)}
/** A direct or explicitly validated nested-UID child under the original ObjectOwned root.
 * Follows that parent's own previousTransaction and input version/digest chain,
 * even when its outer Soul has moved between Kiosks. Never searches an old
 * Kiosk's unrelated versions or an RPC's latest dynamic fields.
 * Caller first authenticates anchor transaction/effects/checkpoint.
 * An explicit nested UID additionally requires caller BCS membership validation
 * at every root version; only that UID may own the child. The caller must
 * qualify actual source proving every target child mutation commits the root;
 * UID containment alone does not establish this parent-commit invariant.
 * The domain caller must prove this parent's original tree membership and
 * derive/check the child's exact typed key. Root owner must remain the same;
 * owner rebinding, unsupported failure and incomplete histories fail closed.
 * Root metadata and checkpoint membership are trusted-RPC evidence, not code
 * qualification, recursive tree coverage, current authority or a sale receipt.
 */
export async function readHistoricalChildThroughOwnedParent(input:{client:SuiGrpcClient;
 anchorEffects:ReturnType<typeof bcs.TransactionEffects.parse>;anchorTransactionDigest:string;anchorCheckpoint:string;
 anchorMode:'input'|'written';rootId:string;rootType:string;rootOwnerId:string;childId:string;childType:string;
 chainIdentifier:string;genesisDigest:string;signal:AbortSignal;nestedParent?:{uid:string;assertContainsParent:(rootBytes:Uint8Array,uid:string)=>void};assertRoot:(bytes:Uint8Array)=>void;maxHops?:number}){
 const {client,rootId,rootType,rootOwnerId,childId,childType,chainIdentifier,genesisDigest,assertRoot}=input
 const nested=input.nestedParent,hasNested=nested!==undefined,parentUid=hasNested?nested?.uid:rootId
 const assertContainsParent=nested?.assertContainsParent,anchorCheckpoint=input.anchorCheckpoint
 const effects=structuredClone(input.anchorEffects),digest=input.anchorTransactionDigest,mode=input.anchorMode,maxHops=input.maxHops??64
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)])
 check([rootId,rootOwnerId,childId].every(id=>/^0x[0-9a-f]{64}$/.test(id)&&BigInt(id)!==0n)
  &&new Set([rootId,rootOwnerId,childId]).size===3,'ROLES')
 check(!hasNested||(typeof parentUid==='string'&&/^0x[0-9a-f]{64}$/.test(parentUid)&&BigInt(parentUid)!==0n
  &&new Set([rootId,rootOwnerId,childId,parentUid]).size===4&&typeof assertContainsParent==='function'),'NESTED_PARENT')
 check(['input','written'].includes(mode)&&typeof assertRoot==='function'&&Number.isSafeInteger(maxHops)&&maxHops>=1&&maxHops<=256,'BOUND')
 let root=await readHistoricalMoveObject({client,effects,transactionDigest:digest,objectId:rootId,type:rootType,mode,signal,maxBytes:256*1024})
 let maxCheckpoint=anchorCheckpoint,totalBytes=0
 const seen=new Set<string>(),trail:Array<{version:string;transactionDigest:string;checkpoint:string}>=[]
 for(let hop=0;hop<maxHops;hop++){
  signal.throwIfAborted();check(root.object.owner.ObjectOwner===rootOwnerId,'OWNER_REBOUND')
  totalBytes+=root.bytes.length;check(totalBytes<=16*1024*1024,'BYTE_BOUND');assertRoot(new Uint8Array(root.bytes))
  if(hasNested)assertContainsParent!(new Uint8Array(root.bytes),parentUid!)
  const previous=root.object.previousTransaction;check(!seen.has(previous),'CYCLE');seen.add(previous)
  const ancestor=await readHistoricalParentTransaction({client,transactionDigest:previous,maxCheckpoint,chainIdentifier,genesisDigest,signal})
  check(ancestor.executionStatus==='Success','UNSUPPORTED_FAILURE')
  const current=historicalObjectOutput(ancestor.effects,rootId)
  check(current.version===root.reference.version&&current.digest===root.reference.digest&&current.owner.ObjectOwner===rootOwnerId,'ROOT_LINK')
  check(!ancestor.sharedInputs.some(ref=>ref.objectId===rootId),'SHARED_INPUT_ALIAS')
  if(!current.created)check(current.inputOwner?.ObjectOwner===rootOwnerId,'INPUT_OWNER_REBOUND')
  trail.push({version:String(current.version),transactionDigest:previous,checkpoint:ancestor.checkpoint})
  const changed=ancestor.effects.V2!.changedObjects.find(([id])=>id===childId)
  if(changed){
   check(changed[1].outputState.$kind==='ObjectWrite','CHILD_REMOVED')
   const child=await readHistoricalMoveObject({client,effects:ancestor.effects,transactionDigest:previous,
    objectId:childId,type:childType,mode:'written',signal,maxBytes:256*1024})
   check(child.object.owner.ObjectOwner===parentUid,'CHILD_OWNER')
   signal.throwIfAborted()
   return {proof:hasNested?'original-nested-child-through-owned-parent-lineage-only' as const:'original-direct-child-through-owned-parent-lineage-only' as const,rootId,rootOwnerId,childId,
    ...(hasNested?{nestedParentUid:parentUid!}:{}),bytes:child.bytes,reference:child.reference,writerTransactionDigest:previous,trail,
    requiresQualifiedParentCommitInvariant:true as const,requiresOriginalTreeMembership:true as const,notRecursiveTreeProof:true as const,notCurrentAuthority:true as const,notBusinessReceipt:true as const}
  }
  check(!current.created,'CHILD_MISSING_AT_CREATION')
  const prior=await readHistoricalMoveObject({client,effects:ancestor.effects,transactionDigest:previous,
   objectId:rootId,type:rootType,mode:'input',signal,maxBytes:256*1024})
  check(prior.reference.version<current.version&&prior.object.owner.ObjectOwner===rootOwnerId,'PRIOR_REFERENCE')
  root=prior;maxCheckpoint=ancestor.checkpoint
 }
 throw Error('HISTORICAL_OWNED_PARENT_HOP_BOUND')
}
