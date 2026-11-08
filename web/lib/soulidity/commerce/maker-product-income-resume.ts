import type { IncomeExecutionRegistryV1 } from './income-execution-source-v1'
import { requireMakerProductIncomeAddressGas } from './maker-product-income-gas'
import { captureMakerProductIncomeClient } from './maker-product-income-client'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {commerceCheck,readCommerceObject} from './economics-read'
import {readMakerProductIncome} from './maker-product-income-read'
import {publicMutationCanonical} from '../../sui/public-mutation-journal'
import {parseMakerProductIncomeRecoveryRecord,makerProductIncomeRecoveryProps} from './maker-product-income-recovery-record'
import {simulateMakerProductIncomeWithdrawal,assertMakerProductIncomeSimulationInputs} from './maker-product-income-simulation'
/** Recheck an existing PREPARED original, without building/replacing any packet.
 * Host owns original journal lock, signature/unknown-attempt exclusion and final
 * signing qualification. A saved PREPARED label alone proves none of these.
 */
export async function recheckMakerProductIncomePrepared(input:{client:SuiGrpcClient;record:unknown;reviewed:Awaited<ReturnType<typeof readMakerProductIncome>>;reviewedGas:Parameters<typeof simulateMakerProductIncomeWithdrawal>[0]['reviewedGas'];getActorAddress:()=>string|null;signal:AbortSignal;executionRegistry?:IncomeExecutionRegistryV1}){
 const executionRegistry=input.executionRegistry
 const record=parseMakerProductIncomeRecoveryRecord(input.record),saved=makerProductIncomeRecoveryProps(record),reviewed=structuredClone(input.reviewed),gas=structuredClone(input.reviewedGas),getActorAddress=input.getActorAddress
 const source=input.client,signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)])
 const client=captureMakerProductIncomeClient(source)
 const guard=()=>{signal.throwIfAborted();commerceCheck(getActorAddress()===saved.intent.actor,'MAKER_INCOME_RESUME_WALLET_CHANGED')}
 guard();commerceCheck(gas.coins.length<=256&&new Set(gas.coins.map(c=>c.objectId)).size===gas.coins.length,'MAKER_INCOME_RESUME_GAS_BOUND')
 commerceCheck(record.packet.phase==='PREPARED'&&record.packet.signature===null,'MAKER_INCOME_RESUME_PREPARED_ONLY')
 async function current(){
  const income=await readMakerProductIncome({client,target:saved.target,control:{actor:saved.intent.actor,objectId:saved.intent.controlId},signal});guard()
  commerceCheck(publicMutationCanonical(income)===publicMutationCanonical(reviewed)&&income.ledger.revision===saved.intent.revision&&BigInt(income.ledger.balance)>=BigInt(saved.intent.amount),'MAKER_INCOME_RESUME_REVIEW_CHANGED')
  if(gas.coins.length===0){await requireMakerProductIncomeAddressGas(client,saved.intent.actor,getActorAddress,signal,gas.budget);guard()}
  for(const ref of gas.coins){const coin=await readCommerceObject(client,ref.objectId,'0x2::coin::Coin<0x2::sui::SUI>',signal);guard();commerceCheck(coin.version===ref.version&&coin.digest===ref.digest&&coin.owner.AddressOwner===saved.intent.actor,'MAKER_INCOME_RESUME_GAS_CHANGED')}
  return income
 }
 await current()
 const simulation=await simulateMakerProductIncomeWithdrawal({client,record,reviewedGas:gas,getActorAddress,signal,executionRegistry});guard()
 assertMakerProductIncomeSimulationInputs(simulation,reviewed)
 await current();guard()
 return {record,simulation,originalBytesUnchanged:true as const,requiresMainOriginalJournalAndUnknownOperationExclusion:true as const,requiresQualifiedSourceAndFinalInterfaceStateWallet:true as const,notSigningQualification:true as const,notWithdrawalEvidence:true as const}
}
