import { readMakerProductIncomeGasWindow } from './maker-product-income-gas'
import type { IncomeExecutionRegistryV1 } from './income-execution-source-v1'
import {bcs} from '@mysten/sui/bcs'
import {Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {fromBase58,fromBase64,fromHex,normalizeStructTag,toBase58,toBase64,toHex} from '@mysten/sui/utils'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import type {PublicMutationPacket} from '../../sui/public-mutation-journal'
import {publicMutationCanonical} from '../../sui/public-mutation-journal'
import {commerceCheck,commerceId} from './economics-read'
import {parseMakerProductIncomeTarget,type MakerProductIncomeTarget} from './maker-product-income-read'
import {readMakerProductIncomeHistory,type MakerProductIncomeIntent} from './maker-product-income-history'

export const MAKER_PRODUCT_INCOME_RECOVERY_SCHEMA='soulidity.maker-product-income-recovery.v1' as const
const MAX_TEXT=300000
export interface MakerProductIncomeRecoveryRecord{
 schema:typeof MAKER_PRODUCT_INCOME_RECOVERY_SCHEMA;target:MakerProductIncomeTarget;packet:PublicMutationPacket;
 intent:Omit<MakerProductIncomeIntent,'attempt'>&{attemptHex:string}
}
function object(v:unknown,keys:string[]):Record<string,any>{
 commerceCheck(v!==null&&typeof v==='object'&&!Array.isArray(v),'MAKER_INCOME_RECORD_OBJECT')
 const row=v as Record<string,any>
 commerceCheck(Object.keys(row).length===keys.length&&Object.keys(row).every(key=>keys.includes(key)),'MAKER_INCOME_RECORD_KEYS');return row
}
function uint(v:unknown,positive=false){commerceCheck(typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n&&(!positive||BigInt(v)>0n),'MAKER_INCOME_RECORD_U64')}
function digest(v:unknown){commerceCheck(typeof v==='string'&&v.length<=64,'MAKER_INCOME_RECORD_DIGEST');const bytes=fromBase58(v);commerceCheck(bytes.length===32&&toBase58(bytes)===v,'MAKER_INCOME_RECORD_DIGEST')}
/** New portable schema constrains supplied original artifacts. It does not
 * claim old journals adopted this schema, migrate another operation, authenticate
 * a saved signature/phase, or prove current authority/finality/payment.
 */
export function parseMakerProductIncomeRecoveryRecord(value:unknown):MakerProductIncomeRecoveryRecord{
 const r=object(value,['schema','target','packet','intent']);commerceCheck(r.schema===MAKER_PRODUCT_INCOME_RECOVERY_SCHEMA,'MAKER_INCOME_RECORD_SCHEMA')
 const t=parseMakerProductIncomeTarget(r.target),pin=t.manufacturing
 const p=object(r.packet,['bytes','digest','expirationEpoch','phase','signature']),i=object(r.intent,['actor','controlId','recipient','amount','revision','attemptHex'])
 commerceCheck([i.actor,i.controlId,i.recipient].every(commerceId)&&i.controlId!==t.productId,'MAKER_INCOME_RECORD_INTENT')
 uint(i.amount,true);uint(i.revision);commerceCheck(BigInt(i.revision)<18446744073709551615n,'MAKER_INCOME_RECORD_REVISION')
 commerceCheck(typeof i.attemptHex==='string'&&/^[0-9a-f]{64}$/.test(i.attemptHex)&&/[1-9a-f]/.test(i.attemptHex),'MAKER_INCOME_RECORD_ATTEMPT')
 uint(p.expirationEpoch);digest(p.digest)
 commerceCheck(['PREPARED','SIGNING','SIGNED','SUCCEEDED','FAILED','CANCELLED','RETIRED'].includes(p.phase)
  &&(p.signature===null||typeof p.signature==='string'&&p.signature.length>0&&p.signature.length<=32768),'MAKER_INCOME_RECORD_PACKET_METADATA')
 commerceCheck(typeof p.bytes==='string'&&p.bytes.length>0&&p.bytes.length<=180000,'MAKER_INCOME_RECORD_PACKET_BOUND')
 const bytes=fromBase64(p.bytes),raw=bcs.TransactionData.parse(bytes),data=Transaction.from(bytes).getData()
 commerceCheck(bytes.length<=128*1024&&toBase64(bytes)===p.bytes&&toBase64(bcs.TransactionData.serialize(raw).toBytes())===p.bytes
  &&TransactionDataBuilder.getDigestFromBytes(bytes)===p.digest&&data.sender===i.actor&&readMakerProductIncomeGasWindow(data,i.actor,p.expirationEpoch),'MAKER_INCOME_RECORD_PACKET')
 const call=data.commands[0]?.MoveCall
 commerceCheck(data.commands.length===1&&data.inputs.length===6&&call&&call.package===pin.callablePackageId&&call.module==='maker_catalog'&&call.function==='withdraw_income'
  &&call.typeArguments.length===1&&normalizeStructTag(call.typeArguments[0])===normalizeStructTag(t.coinType)&&call.arguments.length===6
  &&call.arguments.every((a,index)=>a.$kind==='Input'&&a.Input===index),'MAKER_INCOME_RECORD_GRAPH')
 commerceCheck(data.inputs[0].Object?.SharedObject?.objectId===t.productId&&data.inputs[0].Object?.SharedObject?.mutable===true
  &&data.inputs[1].Object?.ImmOrOwnedObject?.objectId===i.controlId,'MAKER_INCOME_RECORD_OBJECT_INPUTS')
 const pure=[bcs.u64().serialize(i.revision),bcs.u64().serialize(i.amount),bcs.Address.serialize(i.recipient),bcs.byteVector().serialize(fromHex(i.attemptHex))]
 commerceCheck(pure.every((v,index)=>data.inputs[index+2].Pure?.bytes===toBase64(v.toBytes())),'MAKER_INCOME_RECORD_ARGUMENTS')
 return {schema:MAKER_PRODUCT_INCOME_RECOVERY_SCHEMA,target:t,
  packet:{bytes:p.bytes,digest:p.digest,expirationEpoch:p.expirationEpoch,phase:p.phase,signature:p.signature},intent:{actor:i.actor,controlId:i.controlId,recipient:i.recipient,amount:i.amount,revision:i.revision,attemptHex:i.attemptHex}}
}
/** Explicit wrapping only: supplied artifacts remain original, without claiming
 * they were stored using this new schema. No schema-less import or migration. */
export function createMakerProductIncomeRecoveryRecord(input:{target:MakerProductIncomeTarget;packet:PublicMutationPacket;intent:MakerProductIncomeIntent}){
 commerceCheck(input.intent.attempt instanceof Uint8Array,'MAKER_INCOME_RECORD_ATTEMPT')
 return parseMakerProductIncomeRecoveryRecord({schema:MAKER_PRODUCT_INCOME_RECOVERY_SCHEMA,target:input.target,packet:input.packet,
  intent:{actor:input.intent.actor,controlId:input.intent.controlId,recipient:input.intent.recipient,amount:input.intent.amount,revision:input.intent.revision,attemptHex:toHex(input.intent.attempt)}})
}
export function exportMakerProductIncomeRecoveryRecord(record:unknown){const text=publicMutationCanonical(parseMakerProductIncomeRecoveryRecord(record));commerceCheck(text.length<=MAX_TEXT,'MAKER_INCOME_RECORD_EXPORT_BOUND');return text}
export function importMakerProductIncomeRecoveryRecord(text:string){
 commerceCheck(typeof text==='string'&&text.length>0&&text.length<=MAX_TEXT,'MAKER_INCOME_RECORD_IMPORT_BOUND')
 const record=parseMakerProductIncomeRecoveryRecord(JSON.parse(text));commerceCheck(exportMakerProductIncomeRecoveryRecord(record)===text,'MAKER_INCOME_RECORD_NONCANONICAL');return record
}
/** Props for MakerProductIncomeRecovery; caller supplies read client/viewer only.
 * Bytes/digest/target pins never come from current deployment configuration. */
export function makerProductIncomeRecoveryProps(record:unknown){
 const r=parseMakerProductIncomeRecoveryRecord(record),{attemptHex,...intent}=r.intent
 return {target:r.target,packet:r.packet,intent:{...intent,attempt:fromHex(attemptHex)}}
}
/** Query-only import consumer; no storage, wallet, signing, retry or broadcast. */
export async function queryMakerProductIncomeRecoveryRecord(input:{client:SuiGrpcClient;text:string;signal:AbortSignal;executionRegistry?:IncomeExecutionRegistryV1}){
 const props=makerProductIncomeRecoveryProps(importMakerProductIncomeRecoveryRecord(input.text))
 return readMakerProductIncomeHistory({...props,client:input.client,signal:input.signal,executionRegistry:input.executionRegistry})
}
