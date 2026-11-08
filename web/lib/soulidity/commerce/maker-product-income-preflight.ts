import { requireMakerProductIncomeAddressGas } from './maker-product-income-gas'
import { captureMakerProductIncomeClient } from './maker-product-income-client'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {commerceCheck,readCommerceObject} from './economics-read'
import {readMakerProductIncome} from './maker-product-income-read'
import {publicMutationCanonical} from '../../sui/public-mutation-journal'
import {prepareMakerProductIncomeWithdrawal} from './maker-product-income-preparation'
import {simulateMakerProductIncomeWithdrawal,assertMakerProductIncomeSimulationInputs} from './maker-product-income-simulation'

/** One immutable NEW-operation context through preparation and checked simulation.
 * Main must exclude prior unknown attempts before calling, and qualify source,
 * journal and final wallet/state before signing. This function cannot submit.
 */
export async function preflightMakerProductIncomeWithdrawal(input:Parameters<typeof prepareMakerProductIncomeWithdrawal>[0]&{
 onPreparedOriginal?:(record:Awaited<ReturnType<typeof prepareMakerProductIncomeWithdrawal>>['record'])=>Promise<void>
}){
 const {client:source,getActorAddress,signal:parent,onPreparedOriginal,executionRegistry,...values}=input,saved=structuredClone(values)
 const signal=AbortSignal.any([parent,AbortSignal.timeout(60000)]),client=captureMakerProductIncomeClient(source)
 const guard=()=>{signal.throwIfAborted();commerceCheck(getActorAddress()===saved.actor,'MAKER_INCOME_PREFLIGHT_WALLET_CHANGED')}
 guard()
 const prepared=await prepareMakerProductIncomeWithdrawal({...saved,client,getActorAddress,signal,executionRegistry});guard()
 // Host may durably retain the exact original under its own existing lock.
 // Await settlement even on cancellation; callback success is not storage proof.
 if(onPreparedOriginal){await onPreparedOriginal(structuredClone(prepared.record));guard()}
 const simulation=await simulateMakerProductIncomeWithdrawal({client,record:prepared.record,reviewedGas:saved.gas,getActorAddress,signal,executionRegistry});guard()
 commerceCheck(simulation.transactionDigest===prepared.packet.digest,'MAKER_INCOME_PREFLIGHT_DIGEST')
 assertMakerProductIncomeSimulationInputs(simulation,prepared.reviewed)
 // Simulation may await across a concurrent withdrawal, Admin transfer or Gas use.
 // Re-read current inputs without rebuilding or replacing the reviewed operation.
 const current=await readMakerProductIncome({client,target:saved.target,control:{actor:saved.actor,objectId:saved.controlId},signal});guard()
 commerceCheck(publicMutationCanonical(current)===publicMutationCanonical(prepared.reviewed),'MAKER_INCOME_PREFLIGHT_STATE_CHANGED')
 if(saved.gas.coins.length===0){await requireMakerProductIncomeAddressGas(client,saved.actor,getActorAddress,signal,saved.gas.budget);guard()}
 for(const ref of saved.gas.coins){
  const coin=await readCommerceObject(client,ref.objectId,'0x2::coin::Coin<0x2::sui::SUI>',signal);guard()
  commerceCheck(coin.version===ref.version&&coin.digest===ref.digest&&coin.owner.AddressOwner===saved.actor,'MAKER_INCOME_PREFLIGHT_GAS_CHANGED')
 }
 return {prepared,simulation,postSimulationInputsRechecked:true as const,requiresMainDurableJournalAndOldOperationExclusion:true as const,requiresQualifiedSourceAndCurrentAuthority:true as const,requiresFinalInterfaceStateAndWalletRecheck:true as const,notSigningQualification:true as const,notSignedOrExecuted:true as const,notWithdrawalEvidence:true as const}
}
