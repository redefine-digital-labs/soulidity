import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {commerceCheck,readEconomicsIncome,readCommerceObject} from './economics-read'
import {publicMutationCanonical} from '../../sui/public-mutation-journal'
import {prepareNewIncomeWithdrawal} from './income-withdrawal-preparation'
import {simulateNewIncomeWithdrawal,assertIncomeWithdrawalSimulationInputs} from './income-withdrawal-simulation'

/** One immutable NEW-operation context through preparation and checked simulation.
 * Main must exclude prior unknown attempts before calling, and qualify source,
 * journal and final wallet/state before signing. This function cannot submit.
 */
export async function preflightNewIncomeWithdrawal(input:Parameters<typeof prepareNewIncomeWithdrawal>[0]&{
 onPreparedOriginal?:(record:Awaited<ReturnType<typeof prepareNewIncomeWithdrawal>>['record'])=>Promise<void>
}){
 const {client:source,getActorAddress,signal:parent,onPreparedOriginal,executionRegistry,...values}=input,saved=structuredClone(values),ledger=source.ledgerService,core=source.core,execution=source.transactionExecutionService
 const signal=AbortSignal.any([parent,AbortSignal.timeout(60000)]),client={core:{getChainIdentifier:core.getChainIdentifier.bind(core),getMoveFunction:core.getMoveFunction.bind(core)},ledgerService:{getObject:ledger.getObject.bind(ledger),getEpoch:ledger.getEpoch.bind(ledger),getServiceInfo:ledger.getServiceInfo.bind(ledger),getCheckpoint:ledger.getCheckpoint?.bind(ledger),getTransaction:ledger.getTransaction?.bind(ledger)},transactionExecutionService:{simulateTransaction:execution.simulateTransaction.bind(execution)}} as unknown as SuiGrpcClient
 const guard=()=>{signal.throwIfAborted();commerceCheck(getActorAddress()===saved.actor,'WITHDRAW_PREFLIGHT_WALLET_CHANGED')}
 guard()
 const prepared=await prepareNewIncomeWithdrawal({...saved,client,getActorAddress,signal,executionRegistry});guard()
 // Host may durably retain the exact original under its own existing lock.
 // Await settlement even on cancellation; callback success is not storage proof.
 if(onPreparedOriginal){await onPreparedOriginal(structuredClone(prepared.record));guard()}
 const simulation=await simulateNewIncomeWithdrawal({client,record:prepared.record,reviewedGas:saved.gas,getActorAddress,signal,executionRegistry});guard()
 commerceCheck(simulation.transactionDigest===prepared.packet.digest,'WITHDRAW_PREFLIGHT_DIGEST')
 assertIncomeWithdrawalSimulationInputs(simulation,prepared.reviewed)
 // Simulation may await across a concurrent withdrawal, Admin transfer or Gas use.
 // Re-read current inputs without rebuilding or replacing the reviewed operation.
 const current=await readEconomicsIncome({client,target:saved.target,admin:{actor:saved.actor,objectId:saved.adminId},signal});guard()
 commerceCheck(publicMutationCanonical(current)===publicMutationCanonical(prepared.reviewed),'WITHDRAW_PREFLIGHT_STATE_CHANGED')
 for(const ref of saved.gas.coins){
  const coin=await readCommerceObject(client,ref.objectId,'0x2::coin::Coin<0x2::sui::SUI>',signal);guard()
  commerceCheck(coin.version===ref.version&&coin.digest===ref.digest&&coin.owner.AddressOwner===saved.actor,'WITHDRAW_PREFLIGHT_GAS_CHANGED')
 }
 return {prepared,simulation,postSimulationInputsRechecked:true as const,requiresMainDurableJournalAndOldOperationExclusion:true as const,requiresQualifiedSourceAndCurrentAuthority:true as const,requiresFinalInterfaceStateAndWalletRecheck:true as const,notSigningQualification:true as const,notSignedOrExecuted:true as const,notWithdrawalEvidence:true as const}
}
