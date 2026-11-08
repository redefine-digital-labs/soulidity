import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils'
import { SoulPublicKioskBcs } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { historicalObjectOutput, readHistoricalMoveObject, readHistoricalFailedSharedRoot } from '../../sui/historical-object'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { parseFormsManagementRecord } from './application-forms-record'
import type { readFormsHistoricalNativeFields } from './application-forms-historical-native'

function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_LISTING_${code}`) }
const Key = bcs.struct('Listing', { id: bcs.Address, is_exclusive: bcs.bool() })
const Field = bcs.struct('Field', { id: bcs.Address, name: Key, value: bcs.u64() })

type Anchor = { effects: Parameters<typeof readHistoricalMoveObject>[0]['effects']; transactionDigest: string; checkpoint: string }
type Trail = Array<{version:string;transactionDigest:string;checkpoint:string;executionStatus:string}>
type Proof = {fieldId:string;exclusive:boolean;snapshot:'input'|'written';absent:true;reason:'AUTHENTICATED_NOT_EXIST_OUTPUT'|'COMPLETE_PARENT_HISTORY_TO_CREATION';trail:Trail}
/** Private continuation of one original listing state. No RPC absence or
 * partial history is accepted as absence, and no serialized cursor is loaded. */
/** Frozen Forms record adapter only; no record/schema conversion. */
export async function createManagementListingHistorySession(input: Parameters<typeof readFormsHistoricalNativeFields>[0] & {anchor:Anchor;mode:'input'|'written';exclusive:boolean;maxTotalHops?:number}) {
 const p=parseFormsManagementRecord(input.record).plan
 return createManagementKioskListingHistorySession({client:input.client,anchor:input.anchor,mode:input.mode,exclusive:input.exclusive,maxTotalHops:input.maxTotalHops,
  kioskId:p.kioskId,soulId:p.soulId,chainIdentifier:p.target.chainIdentifier,signal:input.signal})
}
/** Schema-independent original Kiosk traversal. Caller must authenticate the
 * anchor transaction/effects/checkpoint and the original custody snapshot. */
export async function createManagementKioskListingHistorySession(input:{client:SuiGrpcClient;anchor:Anchor;mode:'input'|'written';exclusive:boolean;maxTotalHops?:number;kioskId:string;soulId:string;chainIdentifier:string;signal:AbortSignal}) {
  input = {...input,anchor:structuredClone(input.anchor)}
  const {mode,exclusive,kioskId,soulId,chainIdentifier}=input,maxTotalHops=input.maxTotalHops??1024
  check([kioskId,soulId].every(id=>/^0x[0-9a-f]{64}$/.test(id)&&BigInt(id)>0n)&&kioskId!==soulId&&/^[0-9a-f]{8}$/.test(chainIdentifier)
   &&['input','written'].includes(mode)&&typeof exclusive==='boolean','SCOPE')
  check(Number.isSafeInteger(maxTotalHops)&&maxTotalHops>=1&&maxTotalHops<=4096,'TOTAL_BOUND')
  const lifecycle=new AbortController(),signal=AbortSignal.any([input.signal,lifecycle.signal])
  const key={id:soulId,is_exclusive:exclusive},fieldId=deriveDynamicFieldID(kioskId,'0x2::kiosk::Listing',Key.serialize(key).toBytes())
  const args={client:input.client,objectId:kioskId,type:'0x2::kiosk::Kiosk',signal,maxBytes:256*1024}
  let root:Awaited<ReturnType<typeof readHistoricalMoveObject>>|null=null,maximum=input.anchor.checkpoint,totalBytes=0,busy=false,proof:Proof|null=null
  const visited=new Set<string>(),trail:Trail=[]
  const clear=()=>{root=null;proof=null;trail.length=0;visited.clear();totalBytes=0}
  signal.addEventListener('abort',clear,{once:true})
  try{root=await readHistoricalMoveObject({...args,effects:input.anchor.effects,transactionDigest:input.anchor.transactionDigest,mode,
    signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});signal.throwIfAborted()}catch(error){lifecycle.abort();throw error}
  return {
    dispose(){lifecycle.abort();clear()},
    progress:()=>({verifiedHops:trail.length,complete:proof!==null,closed:signal.aborted}),
    async advance(options:{maxHops?:number}={}):Promise<{status:'INCOMPLETE';verifiedHops:number;completeBusinessOutputVerified:false}|{status:'PROVEN';proof:Proof;completeBusinessOutputVerified:false}>{
      signal.throwIfAborted();check(!busy,'SESSION_BUSY');const chunk=options.maxHops??64
      check(Number.isSafeInteger(chunk)&&chunk>=1&&chunk<=256,'HOP_BOUND')
      if(proof)return {status:'PROVEN',proof:structuredClone(proof),completeBusinessOutputVerified:false}
      busy=true;const stepSignal=AbortSignal.any([signal,AbortSignal.timeout(60000)])
      const finish=(reason:Proof['reason'],commit:()=>void)=>{commit();proof={fieldId,exclusive,snapshot:mode,absent:true,reason,trail:structuredClone(trail)};return {status:'PROVEN' as const,proof:structuredClone(proof),completeBusinessOutputVerified:false as const}}
      try {
    for (let hop = 0; hop < chunk; hop++) {
      stepSignal.throwIfAborted(); check(root, 'SESSION_CLOSED'); check(trail.length < maxTotalHops, 'TOTAL_HOP_BOUND'); const nextBytes = totalBytes + root.bytes.length; check(nextBytes <= 16 * 1024 * 1024, 'BYTE_BOUND')
      const kiosk = SoulPublicKioskBcs.parse(root.bytes)
      check(SoulPublicKioskBcs.serialize(kiosk).toBase64() === toBase64(root.bytes) && kiosk.id === kioskId && root.object.owner.Shared, 'PARENT')
      const previous = root.object.previousTransaction; check(!visited.has(previous), 'CYCLE')
      const parent = await readHistoricalParentTransaction({ client: input.client, transactionDigest: previous, maxCheckpoint: maximum,
        chainIdentifier: chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal: stepSignal })
      const failed = parent.executionStatus === 'Failure'
      const output = failed ? (await readHistoricalFailedSharedRoot({ ...args, signal: stepSignal, effects: parent.effects, transactionDigest: previous, mode: 'mutated' })).reference
        : historicalObjectOutput(parent.effects, kioskId)
      check(output.version === root.reference.version && output.digest === root.reference.digest
        && output.owner.Shared?.initialSharedVersion === root.object.owner.Shared.initialSharedVersion, 'PARENT_LINK')
      const inputs = parent.sharedInputs.filter(row => row.objectId === kioskId)
      check(output.created ? inputs.length === 0 : inputs.length === 1 && inputs[0].mutable
        && inputs[0].initialSharedVersion === root.object.owner.Shared.initialSharedVersion, 'PARENT_INPUT')
      const entry = { version: String(output.version), transactionDigest: previous, checkpoint: parent.checkpoint, executionStatus: parent.executionStatus }
      const commit = () => { stepSignal.throwIfAborted(); visited.add(previous); totalBytes = nextBytes; trail.push(entry) }
      const changes = parent.effects.V2!.changedObjects.filter(([id]) => id === fieldId)
      check(!failed || changes.length === 0, 'FAILED_LISTING_CHANGE')
      if (changes.length) {
        check(changes.length === 1, 'LISTING_ALIAS'); const change = changes[0][1]
        if (change.outputState.ObjectWrite) {
          const object = await readHistoricalMoveObject({ client: input.client, effects: parent.effects, transactionDigest: previous, objectId: fieldId,
            type: '0x2::dynamic_field::Field<0x2::kiosk::Listing,u64>', mode: 'written', signal: stepSignal, maxBytes: 1024 })
          const value = Field.parse(object.bytes)
          check(Field.serialize(value).toBase64() === toBase64(object.bytes) && object.object.owner.ObjectOwner === kioskId
            && value.id === fieldId && Key.serialize(value.name).toBase64() === Key.serialize(key).toBase64(), 'LISTING_FIELD')
          check(false, exclusive ? 'EXCLUSIVE_PRESENT' : 'ORDINARY_PRESENT')
        }
        check(change.outputState.$kind === 'NotExist', 'UNSUPPORTED_LISTING_OUTPUT')
        return finish('AUTHENTICATED_NOT_EXIST_OUTPUT', commit)
      }
      if (output.created) return finish('COMPLETE_PARENT_HISTORY_TO_CREATION', commit)
      const prior = await (failed ? readHistoricalFailedSharedRoot : readHistoricalMoveObject)({ ...args, signal: stepSignal, effects: parent.effects, transactionDigest: previous, mode: 'input' })
      check(prior.reference.version < output.version && prior.object.owner.Shared?.initialSharedVersion === root.object.owner.Shared.initialSharedVersion, 'PRIOR_LINK')
      if (failed) check(toBase64(prior.bytes) === toBase64(root.bytes)
        && prior.object.data.Move?.hasPublicTransfer === root.object.data.Move?.hasPublicTransfer, 'FAILED_PARENT_CHANGED')
      const priorKiosk = SoulPublicKioskBcs.parse(prior.bytes)
      check(SoulPublicKioskBcs.serialize(priorKiosk).toBase64() === toBase64(prior.bytes) && priorKiosk.id === kioskId, 'PRIOR_PARENT')
      commit(); root = prior; maximum = parent.checkpoint
    }
      return {status:'INCOMPLETE',verifiedHops:trail.length,completeBusinessOutputVerified:false}
      }finally{busy=false}
    },
  }
}
