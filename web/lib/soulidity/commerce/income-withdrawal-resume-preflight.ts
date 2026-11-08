import type { IncomeExecutionRegistryV1 } from './income-execution-source-v1'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {commerceCheck,readEconomicsIncome,readCommerceObject} from './economics-read'
import {publicMutationCanonical} from '../../sui/public-mutation-journal'
import {parseIncomeWithdrawalRecoveryRecord,incomeWithdrawalRecoveryProps} from './income-withdrawal-recovery-record'
import {simulateNewIncomeWithdrawal,assertIncomeWithdrawalSimulationInputs} from './income-withdrawal-simulation'
/** Recheck an existing PREPARED original, without building/replacing any packet.
 * Host owns original journal lock, signature/unknown-attempt exclusion and final
 * signing qualification. A saved PREPARED label alone proves none of these.
 */
export async function recheckPreparedIncomeWithdrawal(input:{client:SuiGrpcClient;record:unknown;reviewed:Awaited<ReturnType<typeof readEconomicsIncome>>;reviewedGas:Parameters<typeof simulateNewIncomeWithdrawal>[0]['reviewedGas'];getActorAddress:()=>string|null;signal:AbortSignal;executionRegistry?:IncomeExecutionRegistryV1}){
 const executionRegistry=input.executionRegistry
 const record=parseIncomeWithdrawalRecoveryRecord(input.record),saved=incomeWithdrawalRecoveryProps(record),reviewed=structuredClone(input.reviewed),gas=structuredClone(input.reviewedGas),getActorAddress=input.getActorAddress
 const source=input.client,ledger=source.ledgerService,core=source.core,execution=source.transactionExecutionService,signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)])
 const client={core:{getChainIdentifier:core.getChainIdentifier.bind(core),getMoveFunction:core.getMoveFunction.bind(core)},ledgerService:{getObject:ledger.getObject.bind(ledger),getEpoch:ledger.getEpoch.bind(ledger),getServiceInfo:ledger.getServiceInfo.bind(ledger),getCheckpoint:ledger.getCheckpoint?.bind(ledger),getTransaction:ledger.getTransaction?.bind(ledger)},transactionExecutionService:{simulateTransaction:execution.simulateTransaction.bind(execution)}} as unknown as SuiGrpcClient
 const guard=()=>{signal.throwIfAborted();commerceCheck(getActorAddress()===saved.intent.actor,'WITHDRAW_RESUME_WALLET_CHANGED')}
 guard();commerceCheck(gas.coins.length>0&&gas.coins.length<=256&&new Set(gas.coins.map(c=>c.objectId)).size===gas.coins.length,'WITHDRAW_RESUME_GAS_BOUND')
 commerceCheck(record.packet.phase==='PREPARED'&&record.packet.signature===null,'WITHDRAW_RESUME_PREPARED_ONLY')
 async function current(){
  const income=await readEconomicsIncome({client,target:saved.target,admin:{actor:saved.intent.actor,objectId:saved.intent.adminId},signal});guard()
  commerceCheck(publicMutationCanonical(income)===publicMutationCanonical(reviewed)&&income.ledger.revision===saved.intent.revision&&BigInt(income.ledger.balance)>=BigInt(saved.intent.amount),'WITHDRAW_RESUME_REVIEW_CHANGED')
  for(const ref of gas.coins){const coin=await readCommerceObject(client,ref.objectId,'0x2::coin::Coin<0x2::sui::SUI>',signal);guard();commerceCheck(coin.version===ref.version&&coin.digest===ref.digest&&coin.owner.AddressOwner===saved.intent.actor,'WITHDRAW_RESUME_GAS_CHANGED')}
  return income
 }
 await current()
 const simulation=await simulateNewIncomeWithdrawal({client,record,reviewedGas:gas,getActorAddress,signal,executionRegistry});guard()
 assertIncomeWithdrawalSimulationInputs(simulation,reviewed)
 await current();guard()
 return {record,simulation,originalBytesUnchanged:true as const,requiresMainOriginalJournalAndUnknownOperationExclusion:true as const,requiresQualifiedSourceAndFinalInterfaceStateWallet:true as const,notSigningQualification:true as const,notWithdrawalEvidence:true as const}
}
