import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {publicMutationCanonical} from '../sui/public-mutation-journal'
import {withSoulAccessAssetLock} from './soul-access-asset-lock'
import {browserNativePublicReadPaidJournalV2,browserNativePublicReadPaidOriginalReaderV2,nativePublicReadPaidKeyV2,parseNativePublicReadPaidRecordV2,
 queryNativePublicReadPaidRecordV2,NATIVE_PUBLIC_READ_PAID_PREFIX_V2,type NativePublicReadPaidJournalV2,type NativePublicReadPaidOriginalReaderV2,type NativePublicReadPaidRecordV2} from './native-public-read-paid-journal-v2'
import {commerceId} from './commerce/economics-read'

export interface NativePublicReadPaidOriginalScopeV2 {chainIdentifier:string;soulId:string;author:string|null}
function check(value:unknown,code:string):asserts value{if(!value)throw Error(`NATIVE_PUBLIC_READ_PAID_ORIGINAL_RECOVERY_V2_${code}`)}
function scope(input:NativePublicReadPaidOriginalScopeV2){
 const saved=structuredClone(input)
 check(/^[0-9a-f]{8}$/.test(saved.chainIdentifier)&&commerceId(saved.soulId)&&(saved.author===null||commerceId(saved.author)),'SCOPE')
 return saved
}
export function nativePublicReadPaidOriginalIdV2(record: NativePublicReadPaidRecordV2) {
 return `${nativePublicReadPaidKeyV2(record.plan)}:${record.packet.digest}`
}

/** Discover intact originals from both the active head and its archive. */
export async function discoverNativePublicReadPaidOriginalsV2(input:NativePublicReadPaidOriginalScopeV2,reader:NativePublicReadPaidOriginalReaderV2=browserNativePublicReadPaidOriginalReaderV2()){
 const selected=scope(input)
 const prefix=NATIVE_PUBLIC_READ_PAID_PREFIX_V2+selected.chainIdentifier+':'+selected.soulId+':'
 const keys=selected.author===null
  ? (await reader.heads(key=>key.startsWith(prefix))).map(record=>nativePublicReadPaidKeyV2(record.plan))
  : [nativePublicReadPaidKeyV2({...selected,author:selected.author})]
 const result=new Map<string,NativePublicReadPaidRecordV2>()
 for(const key of keys){
  const archived=await reader.history(key), head=await reader.read(key)
  if(head)result.set(nativePublicReadPaidOriginalIdV2(head),head)
  for(const record of archived){
   const id=nativePublicReadPaidOriginalIdV2(record), existing=result.get(id)
   check(!existing||publicMutationCanonical(existing)===publicMutationCanonical(record),'ARCHIVE_CONFLICT')
   result.set(id,record)
  }
 }
 return [...result.values()]
}
function originalClient(source:SuiGrpcClient):SuiGrpcClient{
 const service=source.ledgerService
 return {ledgerService:{getServiceInfo:service.getServiceInfo.bind(service),getTransaction:service.getTransaction.bind(service),getCheckpoint:service.getCheckpoint.bind(service),getObject:service.getObject.bind(service)}} as unknown as SuiGrpcClient
}
/** Query the selected original, including a previously selected archive, with
 * its saved bytes/pins. No head adoption, new ABI/config or phase promotion. */
export function queryNativePublicReadPaidOriginalV2(input:{record:NativePublicReadPaidRecordV2;client:SuiGrpcClient;signal:AbortSignal}){
 const record=structuredClone(input.record),client=originalClient(input.client),signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)])
 signal.throwIfAborted();return queryNativePublicReadPaidRecordV2(record,client,signal)
}
/** Local unsigned cancellation, not an on-chain cancellation or a wallet
 * action. Intact journal/no external signing remains the original assumption.
 * Keep original text forever, and hold both locks through every initiated
 * write/readback even if the caller stops or persistence acknowledgement fails. */
export function cancelNativePublicReadPaidOriginalV2(input:{record:NativePublicReadPaidRecordV2;client:SuiGrpcClient;signal:AbortSignal;journal?:NativePublicReadPaidJournalV2}){
 const selected=structuredClone(input.record),client=originalClient(input.client),signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)])
 const asset={chainIdentifier:selected.plan.chainIdentifier,soulId:selected.plan.soulId,author:selected.plan.author},key=nativePublicReadPaidKeyV2(asset)
 const providedJournal=input.journal
 return withSoulAccessAssetLock(asset,async()=>{
  signal.throwIfAborted();const expected=await parseNativePublicReadPaidRecordV2(selected),journal=providedJournal??browserNativePublicReadPaidJournalV2()
  return journal.exclusive(key,async()=>{
   signal.throwIfAborted();const current=await journal.read(key)
   check(current&&publicMutationCanonical(current)===publicMutationCanonical(expected),'SELECTED_ORIGINAL_CHANGED')
   check(current.packet.phase==='PREPARED'&&current.packet.signature===null,'CANNOT_CANCEL_SIGNING_OR_TERMINAL')
   const observed=await queryNativePublicReadPaidRecordV2(current,client,signal)
   check(observed.status==='MISSING','ORIGINAL_RESULT_NOT_MISSING');signal.throwIfAborted()
   const cancelled=await parseNativePublicReadPaidRecordV2({...current,packet:{...current.packet,phase:'CANCELLED'}})
   signal.throwIfAborted();await journal.write(key,cancelled)
   const retained=await journal.read(key)
   check(retained&&publicMutationCanonical(retained)===publicMutationCanonical(cancelled)&&retained.plan.originalText===expected.plan.originalText,'PERSISTENCE_FAILED')
   signal.throwIfAborted();return {record:retained,original:observed,notOnChainCancellation:true as const,notPermissionToRetryPayment:true as const}
  })
 })
}
