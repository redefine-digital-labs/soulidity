import type { IncomeExecutionRegistryV1 } from './income-execution-source-v1'
import {bcs} from '@mysten/sui/bcs'
import {Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {fromBase58,fromBase64,fromHex,normalizeStructTag,toBase58,toBase64,toHex} from '@mysten/sui/utils'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import type {PublicMutationPacket} from '../../sui/public-mutation-journal'
import {publicMutationCanonical} from '../../sui/public-mutation-journal'
import {commerceCheck,commerceId,type EconomicsTarget} from './economics-read'
import {readIncomeWithdrawalHistory,type WithdrawalIntent} from './income-withdrawal-history'

export const INCOME_WITHDRAWAL_RECOVERY_SCHEMA='soulidity.income-withdrawal-recovery.v1' as const
const MAX_TEXT=300000
export interface IncomeWithdrawalRecoveryRecord{
 schema:typeof INCOME_WITHDRAWAL_RECOVERY_SCHEMA;target:EconomicsTarget;packet:PublicMutationPacket;
 intent:Omit<WithdrawalIntent,'attempt'>&{attemptHex:string}
}
function object(v:unknown,keys:string[]):Record<string,any>{
 commerceCheck(v!==null&&typeof v==='object'&&!Array.isArray(v),'WITHDRAW_RECORD_OBJECT')
 const row=v as Record<string,any>
 commerceCheck(Object.keys(row).length===keys.length&&Object.keys(row).every(key=>keys.includes(key)),'WITHDRAW_RECORD_KEYS');return row
}
function uint(v:unknown,positive=false){commerceCheck(typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n&&(!positive||BigInt(v)>0n),'WITHDRAW_RECORD_U64')}
function digest(v:unknown){commerceCheck(typeof v==='string'&&v.length<=64,'WITHDRAW_RECORD_DIGEST');const bytes=fromBase58(v);commerceCheck(bytes.length===32&&toBase58(bytes)===v,'WITHDRAW_RECORD_DIGEST')}
/** New portable schema constrains supplied original artifacts. It does not
 * claim old journals adopted this schema, migrate another operation, authenticate
 * a saved signature/phase, or prove current authority/finality/payment.
 */
export function parseIncomeWithdrawalRecoveryRecord(value:unknown):IncomeWithdrawalRecoveryRecord{
 const r=object(value,['schema','target','packet','intent']);commerceCheck(r.schema===INCOME_WITHDRAWAL_RECOVERY_SCHEMA,'WITHDRAW_RECORD_SCHEMA')
 const t=object(r.target,['chainIdentifier','foundation','configId','coinType']),pin=object(t.foundation,['originalPackageId','callablePackageId','callableDigest'])
 commerceCheck(t.chainIdentifier==='35834a8a'&&commerceId(t.configId)&&commerceId(pin.originalPackageId)&&commerceId(pin.callablePackageId),'WITHDRAW_RECORD_TARGET')
 digest(pin.callableDigest)
 commerceCheck(typeof t.coinType==='string'&&t.coinType.length<=2048,'WITHDRAW_RECORD_COIN');normalizeStructTag(t.coinType)
 const p=object(r.packet,['bytes','digest','expirationEpoch','phase','signature']),i=object(r.intent,['actor','adminId','recipient','amount','revision','attemptHex'])
 commerceCheck([i.actor,i.adminId,i.recipient].every(commerceId)&&i.adminId!==t.configId,'WITHDRAW_RECORD_INTENT')
 uint(i.amount,true);uint(i.revision);commerceCheck(BigInt(i.revision)<18446744073709551615n,'WITHDRAW_RECORD_REVISION')
 commerceCheck(typeof i.attemptHex==='string'&&/^[0-9a-f]{64}$/.test(i.attemptHex)&&/[1-9a-f]/.test(i.attemptHex),'WITHDRAW_RECORD_ATTEMPT')
 uint(p.expirationEpoch);digest(p.digest)
 commerceCheck(['PREPARED','SIGNING','SIGNED','SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(p.phase)
  &&(p.signature===null||typeof p.signature==='string'&&p.signature.length>0&&p.signature.length<=32768),'WITHDRAW_RECORD_PACKET_METADATA')
 commerceCheck(typeof p.bytes==='string'&&p.bytes.length>0&&p.bytes.length<=180000,'WITHDRAW_RECORD_PACKET_BOUND')
 const bytes=fromBase64(p.bytes),raw=bcs.TransactionData.parse(bytes),data=Transaction.from(bytes).getData()
 commerceCheck(bytes.length<=128*1024&&toBase64(bytes)===p.bytes&&toBase64(bcs.TransactionData.serialize(raw).toBytes())===p.bytes
  &&TransactionDataBuilder.getDigestFromBytes(bytes)===p.digest&&data.sender===i.actor&&Number.isSafeInteger(raw.V1.expiration.Epoch)
  &&String(raw.V1.expiration.Epoch)===p.expirationEpoch,'WITHDRAW_RECORD_PACKET')
 const call=data.commands[0]?.MoveCall
 commerceCheck(data.commands.length===1&&data.inputs.length===6&&call&&call.package===pin.callablePackageId&&call.module==='economics'&&call.function==='withdraw_income'
  &&call.typeArguments.length===1&&normalizeStructTag(call.typeArguments[0])===normalizeStructTag(t.coinType)&&call.arguments.length===6
  &&call.arguments.every((a,index)=>a.$kind==='Input'&&a.Input===index),'WITHDRAW_RECORD_GRAPH')
 commerceCheck(data.inputs[0].Object?.SharedObject?.objectId===t.configId&&data.inputs[0].Object?.SharedObject?.mutable===true
  &&data.inputs[1].Object?.ImmOrOwnedObject?.objectId===i.adminId,'WITHDRAW_RECORD_OBJECT_INPUTS')
 const pure=[bcs.u64().serialize(i.revision),bcs.u64().serialize(i.amount),bcs.Address.serialize(i.recipient),bcs.byteVector().serialize(fromHex(i.attemptHex))]
 commerceCheck(pure.every((v,index)=>data.inputs[index+2].Pure?.bytes===toBase64(v.toBytes())),'WITHDRAW_RECORD_ARGUMENTS')
 return {schema:INCOME_WITHDRAWAL_RECOVERY_SCHEMA,target:{chainIdentifier:t.chainIdentifier,configId:t.configId,coinType:t.coinType,foundation:{originalPackageId:pin.originalPackageId,callablePackageId:pin.callablePackageId,callableDigest:pin.callableDigest}},
  packet:{bytes:p.bytes,digest:p.digest,expirationEpoch:p.expirationEpoch,phase:p.phase,signature:p.signature},intent:{actor:i.actor,adminId:i.adminId,recipient:i.recipient,amount:i.amount,revision:i.revision,attemptHex:i.attemptHex}}
}
/** Explicit wrapping only: supplied artifacts remain original, without claiming
 * they were stored using this new schema. No schema-less import or migration. */
export function createIncomeWithdrawalRecoveryRecord(input:{target:EconomicsTarget;packet:PublicMutationPacket;intent:WithdrawalIntent}){
 commerceCheck(input.intent.attempt instanceof Uint8Array,'WITHDRAW_RECORD_ATTEMPT')
 return parseIncomeWithdrawalRecoveryRecord({schema:INCOME_WITHDRAWAL_RECOVERY_SCHEMA,target:input.target,packet:input.packet,
  intent:{actor:input.intent.actor,adminId:input.intent.adminId,recipient:input.intent.recipient,amount:input.intent.amount,revision:input.intent.revision,attemptHex:toHex(input.intent.attempt)}})
}
export function exportIncomeWithdrawalRecoveryRecord(record:unknown){const text=publicMutationCanonical(parseIncomeWithdrawalRecoveryRecord(record));commerceCheck(text.length<=MAX_TEXT,'WITHDRAW_RECORD_EXPORT_BOUND');return text}
export function importIncomeWithdrawalRecoveryRecord(text:string){
 commerceCheck(typeof text==='string'&&text.length>0&&text.length<=MAX_TEXT,'WITHDRAW_RECORD_IMPORT_BOUND')
 const record=parseIncomeWithdrawalRecoveryRecord(JSON.parse(text));commerceCheck(exportIncomeWithdrawalRecoveryRecord(record)===text,'WITHDRAW_RECORD_NONCANONICAL');return record
}
/** Props for IncomeWithdrawalRecovery; caller supplies read client/viewer only.
 * Bytes/digest/target pins never come from current deployment configuration. */
export function incomeWithdrawalRecoveryProps(record:unknown){
 const r=parseIncomeWithdrawalRecoveryRecord(record),{attemptHex,...intent}=r.intent
 return {target:r.target,packet:r.packet,intent:{...intent,attempt:fromHex(attemptHex)}}
}
/** Query-only import consumer; no storage, wallet, signing, retry or broadcast. */
export async function queryIncomeWithdrawalRecoveryRecord(input:{client:SuiGrpcClient;text:string;signal:AbortSignal;executionRegistry?:IncomeExecutionRegistryV1}){
 const props=incomeWithdrawalRecoveryProps(importIncomeWithdrawalRecoveryRecord(input.text))
 return readIncomeWithdrawalHistory({...props,client:input.client,signal:input.signal,executionRegistry:input.executionRegistry})
}
