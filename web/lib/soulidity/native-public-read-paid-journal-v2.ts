import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {fromBase58,fromBase64,toBase58,toBase64} from '@mysten/sui/utils'
import {createAsyncPublicMutationStore,publicMutationCanonical,type AsyncPublicMutationStorage,type PublicMutationPacket,type AsyncPublicMutationStore} from '../sui/public-mutation-journal'
import {parsePurchaseRecoveryOriginal,queryPurchaseRecoveryOriginal} from './commerce/purchase-recovery-original'
import {captureSameSoulMutationClient} from './same-soul-mutation-client'
import {validateNativePaidRetirementEvidenceV2,verifyNativePaidRetirementV2,ROOT_NATIVE_PAID_RETIREMENT_SOURCES_V2,
 type NativePaidRetirementEvidenceV2} from './commerce/native-public-read-paid-retirement-v2'
import type {SoulAccessAssetScope} from './soul-access-asset-lock'

/** The Root canonical V2 public-operation domain. The raw producer original is
 * immutable; journal phase never rewrites or converts its packet/byte fields. */
export const NATIVE_PUBLIC_READ_PAID_PREFIX_V2='soulidity.native-public-read-paid.v2:'
export const NATIVE_PUBLIC_READ_PAID_CHANGED_V2='soulidity:native-public-read-paid-v2-changed'
export interface NativePublicReadPaidPlanV2 extends SoulAccessAssetScope {originalText:string}
export interface NativePublicReadPaidRecordV2 {
 schema:'soulidity.native-public-read-paid-operation.v2'
 plan:NativePublicReadPaidPlanV2
 packet:PublicMutationPacket
 retirement?:NativePaidRetirementEvidenceV2
}
export type NativePublicReadPaidJournalV2=AsyncPublicMutationStore<NativePublicReadPaidPlanV2,NativePublicReadPaidRecordV2>
export type NativePublicReadPaidOriginalReaderV2=Pick<NativePublicReadPaidJournalV2,'read'|'heads'|'history'>
const phases=['PREPARED','SIGNING','SIGNED','SUCCEEDED','FAILED','CANCELLED','RETIRED']
const terminals=['SUCCEEDED','FAILED','CANCELLED','RETIRED']
function check(v:unknown,code:string):asserts v{if(!v)throw Error(`NATIVE_PUBLIC_READ_PAID_JOURNAL_V2_${code}`)}
function exact(v:unknown,names:string[]):asserts v is Record<string,unknown>{check(v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===names.slice().sort().join(),'FIELDS')}
function id(value:unknown){return typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)}
function digest(value:string){const bytes=fromBase58(value);check(bytes.length===32&&toBase58(bytes)===value,'DIGEST')}
function scopeKey(scope:SoulAccessAssetScope){return NATIVE_PUBLIC_READ_PAID_PREFIX_V2+[scope.chainIdentifier,scope.soulId,scope.author].join(':')}
export function nativePublicReadPaidKeyV2(scope:SoulAccessAssetScope){
 check(/^[0-9a-f]{8}$/.test(scope.chainIdentifier)&&id(scope.soulId)&&id(scope.author),'SCOPE')
 return scopeKey(scope)
}
export async function parseNativePublicReadPaidRecordV2(input:unknown):Promise<NativePublicReadPaidRecordV2>{
 const r=structuredClone(input) as NativePublicReadPaidRecordV2
 exact(r,['schema','plan','packet',...(r?.retirement!==undefined?['retirement']:[])]);check(r.schema==='soulidity.native-public-read-paid-operation.v2','SCHEMA')
 exact(r.plan,['chainIdentifier','soulId','author','originalText']);nativePublicReadPaidKeyV2(r.plan)
 check(typeof r.plan.originalText==='string','ORIGINAL_TEXT')
 exact(r.packet,['bytes','digest','expirationEpoch','phase','signature'])
 check(phases.includes(r.packet.phase),'PHASE')
 check(r.packet.signature===null||typeof r.packet.signature==='string'&&r.packet.signature.length>0&&r.packet.signature.length<=32768&&toBase64(fromBase64(r.packet.signature))===r.packet.signature,'SIGNATURE')
 check(r.packet.phase!=='SIGNED'||r.packet.signature!==null,'SIGNATURE_REQUIRED')
 check(!['PREPARED','SIGNING','CANCELLED'].includes(r.packet.phase)||r.packet.signature===null,'UNEXPECTED_SIGNATURE')
 check((r.packet.phase==='RETIRED')===(r.retirement!==undefined),'RETIREMENT_SCOPE')
 if(r.retirement)validateNativePaidRetirementEvidenceV2(r.retirement,r.packet)
 const original=await parsePurchaseRecoveryOriginal(r.plan.originalText,r.plan.soulId)
 check(original.kind==='native-public-read-v2','ORIGINAL_FORMAT')
 const v=original.value,p=v.packet
 check(!r.retirement||'conflict' in r.retirement||r.retirement.host.objectId===v.intent.host.objectId
  &&r.retirement.ledger.objectId===v.context.originalReceiptContext.ledgerId,'RETIREMENT_ORIGINAL_SCOPE')
 check(p.phase==='PREPARED'&&p.signature===null,'ORIGINAL_NOT_PREPARED')
 check(v.context.economics.chainIdentifier===r.plan.chainIdentifier&&v.intent.buyer===r.plan.author,'ORIGINAL_SCOPE')
 check(publicMutationCanonical({bytes:p.bytes,digest:p.digest,expirationEpoch:p.expirationEpoch})===publicMutationCanonical({bytes:r.packet.bytes,digest:r.packet.digest,expirationEpoch:r.packet.expirationEpoch}),'ORIGINAL_PACKET_CHANGED')
 return r
}
export async function nativePublicReadPaidRecordFromOriginalV2(originalText:string,soulId:string){
 const original=await parsePurchaseRecoveryOriginal(originalText,soulId);check(original.kind==='native-public-read-v2','ORIGINAL_FORMAT')
 return parseNativePublicReadPaidRecordV2({schema:'soulidity.native-public-read-paid-operation.v2',
  plan:{chainIdentifier:original.value.context.economics.chainIdentifier,soulId,author:original.value.intent.buyer,originalText},packet:original.value.packet})
}
function createNativePublicReadPaidJournalV2(storage?:AsyncPublicMutationStorage,readOnly=false):NativePublicReadPaidJournalV2{
 return createAsyncPublicMutationStore({prefix:NATIVE_PUBLIC_READ_PAID_PREFIX_V2,changedEvent:NATIVE_PUBLIC_READ_PAID_CHANGED_V2,errorPrefix:'NATIVE_PUBLIC_READ_PAID_JOURNAL_V2',
  key:nativePublicReadPaidKeyV2,parse:parseNativePublicReadPaidRecordV2,storage,readOnly,
  classify:name=>{
   const parts=name.slice(NATIVE_PUBLIC_READ_PAID_PREFIX_V2.length).split(':')
   check(parts.length===3||parts.length===6&&parts[3]==='history'&&terminals.includes(parts[5]),'OPAQUE_HEAD_KEY')
   const headKey=nativePublicReadPaidKeyV2({chainIdentifier:parts[0],soulId:parts[1],author:parts[2]})
   if(parts.length===6)digest(parts[4])
   return {headKey,archived:parts.length===6}
  }})
}
export function browserNativePublicReadPaidJournalV2(storage?:AsyncPublicMutationStorage):NativePublicReadPaidJournalV2{
 return createNativePublicReadPaidJournalV2(storage)
}
/** Same Root domain/parser/classifier and immutable text; no new store or key.
 * Expose no mutation API to config-independent original recovery readers. */
export function browserNativePublicReadPaidOriginalReaderV2(storage?:AsyncPublicMutationStorage):NativePublicReadPaidOriginalReaderV2{
 const {read,heads,history}=createNativePublicReadPaidJournalV2(storage,true)
 return {read,heads,history}
}
export function discoverNativePublicReadPaidAssetV2(journal:Pick<NativePublicReadPaidJournalV2,'heads'>,scope:SoulAccessAssetScope){
 // A legacy scope can use a different original package; it never supplies or
 // fabricates a V2 deployment. Strict parsing still authenticates every match.
 const key=scopeKey(scope);return journal.heads(head=>head===key)
}
export async function queryNativePublicReadPaidRecordV2(input:NativePublicReadPaidRecordV2,client:SuiGrpcClient,signal:AbortSignal){
 const record=await parseNativePublicReadPaidRecordV2(input)
 const result=await queryPurchaseRecoveryOriginal({text:record.plan.originalText,soulId:record.plan.soulId,client,signal})
 check(result.kind==='native-public-read-v2','QUERY_FORMAT');return result.history
}
// A raw history lookup remains useful for export/recovery. Only this fresh
// checked observation may release a RETIRED head in a guarded mutation.
const verifiedRetirements=new WeakMap<object,string>()
export async function queryNativePublicReadPaidHeadV2(record:NativePublicReadPaidRecordV2,source:SuiGrpcClient,signal:AbortSignal){
 if(record.packet.phase!=='RETIRED')return queryNativePublicReadPaidRecordV2(record,source,signal)
 const client=captureSameSoulMutationClient(source,signal),admissions=structuredClone(ROOT_NATIVE_PAID_RETIREMENT_SOURCES_V2)
 const saved=await parseNativePublicReadPaidRecordV2(record)
 const original=await parsePurchaseRecoveryOriginal(saved.plan.originalText,saved.plan.soulId)
 check(original.kind==='native-public-read-v2','ORIGINAL_FORMAT')
 const result=await verifyNativePaidRetirementV2({original:original.value,client,signal,sources:admissions,saved:saved.retirement,
  queryOriginal:()=>queryNativePublicReadPaidRecordV2(saved,client,signal)})
 verifiedRetirements.set(result.observed,publicMutationCanonical(saved))
 return result.observed
}
type PaidOriginalObservation = { status: string; checkpoint?: string; receipt?: {
 transactionDigest: string; checkpoint: string; money?: { transactionDigest: string; buyer: string } | null
} }

/** Settlement terminates this payment packet. Content is opened separately
 * under current access and Seal, including after a new head is prepared. */
export function nativePublicReadPaidSettlementMatchesV2(record: { packet: { digest: string }; plan: { author: string } }, result: PaidOriginalObservation) {
 const receipt = result.receipt, digest = record.packet.digest
 return result.status === 'SUBSCRIPTION_RECORDED' && typeof result.checkpoint === 'string'
  && receipt?.checkpoint === result.checkpoint && receipt.transactionDigest === digest
  && receipt.money?.transactionDigest === digest && receipt.money.buyer === record.plan.author
}
export function nativePublicReadPaidHeadCanClearV2(record: NativePublicReadPaidRecordV2, result: PaidOriginalObservation) {
 if(record.packet.phase==='RETIRED'){
  const proof=verifiedRetirements.get(result)
  verifiedRetirements.delete(result)
  return result.status==='MISSING'&&proof===publicMutationCanonical(record)
 }
 const settled = nativePublicReadPaidSettlementMatchesV2(record, result)
 if (record.packet.phase === 'SUCCEEDED') check(settled, 'TERMINAL_RESULT_UNCONFIRMED')
 if (record.packet.phase === 'FAILED') check(result.status === 'FAILED', 'TERMINAL_RESULT_UNCONFIRMED')
 return settled || result.status === 'FAILED'
  || record.packet.phase === 'CANCELLED' && record.packet.signature === null && result.status === 'MISSING'
}
