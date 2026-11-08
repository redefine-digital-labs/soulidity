import { parseIncomeObservationTarget } from './income-source-qualification'
import { assertIncomeExecutionRegistrySupportsTargetV1, EMPTY_INCOME_EXECUTION_REGISTRY_V1, type IncomeExecutionRegistryV1 } from './income-execution-source-v1'
import {bcs} from '@mysten/sui/bcs'
import {Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {fromBase58,toBase58,toBase64} from '@mysten/sui/utils'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {publicMutationCanonical} from '../../sui/public-mutation-journal'
import {readEconomicsIncome,readCommerceObject,decodeCommerce,commerceCheck,commerceId,type EconomicsTarget} from './economics-read'
import {verifyIncomeWithdrawalInterface} from './income-withdrawal-interface'
import {buildIncomeWithdrawal} from './income-withdrawal'
import {createIncomeWithdrawalRecoveryRecord} from './income-withdrawal-recovery-record'
const MAX=18446744073709551615n,Coin=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()})
type Reference={objectId:string;version:string;digest:string}
/** NEW operation draft only, after main excludes prior active/unknown attempts.
 * No journal exclusion is performed or inferred here. No signing, gas selection,
 * broadcast, simulation, source adoption or permission to repeat old operations.
 */
export async function prepareNewIncomeWithdrawal(input:{kind:'NEW_INCOME_WITHDRAWAL';client:SuiGrpcClient;target:EconomicsTarget;
 actor:string;adminId:string;recipient:string;amount:string;attempt:Uint8Array;reviewed:Awaited<ReturnType<typeof readEconomicsIncome>>;
 gas:{budget:string;price:string;coins:Reference[]};expirationEpoch:string;getActorAddress:()=>string|null;signal:AbortSignal;executionRegistry?:IncomeExecutionRegistryV1}){
 const {client:source,signal:parent,getActorAddress,executionRegistry=EMPTY_INCOME_EXECUTION_REGISTRY_V1,...values}=input,saved=structuredClone(values),ledger=source.ledgerService
 const signal=AbortSignal.any([parent,AbortSignal.timeout(60000)]),client={core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core),getMoveFunction:source.core.getMoveFunction.bind(source.core)},ledgerService:{getObject:ledger.getObject.bind(ledger),getEpoch:ledger.getEpoch.bind(ledger)}} as unknown as SuiGrpcClient
 saved.target=parseIncomeObservationTarget(saved.target)
 assertIncomeExecutionRegistrySupportsTargetV1(executionRegistry,saved.target)
 const guard=()=>{signal.throwIfAborted();commerceCheck(getActorAddress()===saved.actor,'WITHDRAW_PREPARE_WALLET_CHANGED')}
 const uint=(v:string)=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)&&BigInt(v)<=MAX
 commerceCheck(saved.kind==='NEW_INCOME_WITHDRAWAL'&&[saved.actor,saved.adminId,saved.recipient].every(commerceId)
  &&uint(saved.amount)&&uint(saved.gas.budget)&&uint(saved.gas.price)&&/^(0|[1-9][0-9]{0,15})$/.test(saved.expirationEpoch)&&Number.isSafeInteger(Number(saved.expirationEpoch))
  &&saved.attempt instanceof Uint8Array&&saved.attempt.length===32&&saved.attempt.some(v=>v!==0),'WITHDRAW_PREPARE_INPUT')
 commerceCheck(saved.gas.coins.length>0&&saved.gas.coins.length<=256&&new Set(saved.gas.coins.map(c=>c.objectId)).size===saved.gas.coins.length,'WITHDRAW_PREPARE_GAS')
 for(const ref of saved.gas.coins){commerceCheck(commerceId(ref.objectId)&&![saved.target.configId,saved.adminId].includes(ref.objectId)&&uint(ref.version)&&typeof ref.digest==='string'&&ref.digest.length<=64,'WITHDRAW_PREPARE_GAS_REF')
  const bytes=fromBase58(ref.digest);commerceCheck(bytes.length===32&&toBase58(bytes)===ref.digest,'WITHDRAW_PREPARE_GAS_REF')}
 guard()
 const request={client,target:saved.target,admin:{actor:saved.actor,objectId:saved.adminId},signal}
 const observed=await readEconomicsIncome(request);guard()
 commerceCheck(publicMutationCanonical(observed)===publicMutationCanonical(saved.reviewed),'WITHDRAW_PREPARE_REVIEW_CHANGED')
 commerceCheck(BigInt(saved.amount)<=BigInt(observed.ledger.balance),'WITHDRAW_PREPARE_AMOUNT')
 const interfaceProof=await verifyIncomeWithdrawalInterface({client,foundation:saved.target.foundation,signal});guard()
 const config=await readCommerceObject(client,saved.target.configId,observed.configType,signal);guard()
 commerceCheck(config.version===observed.object.version&&config.digest===observed.object.digest&&config.owner.Shared,'WITHDRAW_PREPARE_CONFIG')
 const birth=config.owner.Shared!.initialSharedVersion
 async function epoch(){guard();const row=(await client.ledgerService.getEpoch({readMask:{paths:['epoch','reference_gas_price']}},{abort:signal})).response.epoch;guard()
  commerceCheck(typeof row?.epoch==='bigint'&&typeof row.referenceGasPrice==='bigint'&&row.referenceGasPrice>0n&&BigInt(saved.expirationEpoch)>=row.epoch&&BigInt(saved.expirationEpoch)<=row.epoch+1n&&BigInt(saved.gas.price)>=row.referenceGasPrice,'WITHDRAW_PREPARE_EPOCH_OR_PRICE')}
 async function funds(){let sum=0n;for(const ref of saved.gas.coins){guard();const row=await readCommerceObject(client,ref.objectId,'0x2::coin::Coin<0x2::sui::SUI>',signal),coin=decodeCommerce(Coin,row.contents);guard()
  commerceCheck(row.version===ref.version&&row.digest===ref.digest&&row.owner.AddressOwner===saved.actor&&coin.id===ref.objectId,'WITHDRAW_PREPARE_GAS_COIN');sum+=BigInt(coin.balance)}
  commerceCheck(sum>=BigInt(saved.gas.budget)&&sum<=MAX,'WITHDRAW_PREPARE_GAS_BALANCE');return String(sum)}
 await epoch();const gasBalance=await funds()
 const tx=buildIncomeWithdrawal(observed,{actor:saved.actor,recipient:saved.recipient,amount:BigInt(saved.amount),attempt:saved.attempt,configInitialSharedVersion:birth})
 tx.setGasOwner(saved.actor);tx.setGasBudget(BigInt(saved.gas.budget));tx.setGasPrice(BigInt(saved.gas.price));tx.setGasPayment(saved.gas.coins);tx.setExpiration({Epoch:Number(saved.expirationEpoch)})
 const bytes=await tx.build();guard()
 const packet={bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch:saved.expirationEpoch,phase:'PREPARED' as const,signature:null}
 const intent={actor:saved.actor,adminId:saved.adminId,recipient:saved.recipient,amount:saved.amount,revision:observed.ledger.revision,attempt:saved.attempt}
 const record=createIncomeWithdrawalRecoveryRecord({target:saved.target,packet,intent}),gas=Transaction.from(bytes).getData().gasData
 commerceCheck(gas.owner===saved.actor&&gas.budget===saved.gas.budget&&gas.price===saved.gas.price&&publicMutationCanonical(gas.payment)===publicMutationCanonical(saved.gas.coins),'WITHDRAW_PREPARE_PACKET_GAS')
 const final=await readEconomicsIncome(request);guard();commerceCheck(publicMutationCanonical(final)===publicMutationCanonical(observed),'WITHDRAW_PREPARE_CHANGED')
 const finalConfig=await readCommerceObject(client,saved.target.configId,observed.configType,signal);guard()
 commerceCheck(finalConfig.version===config.version&&finalConfig.digest===config.digest&&finalConfig.owner.Shared?.initialSharedVersion===birth,'WITHDRAW_PREPARE_CONFIG_CHANGED')
 await funds();await epoch();guard()
 return {record,packet,intent,interfaceProof,reviewed:final,reviewedGas:saved.gas,gasBalance,requiresMainDurableJournalAndOldOperationExclusion:true as const,
  requiresQualifiedSource:true as const,requiresFinalInterfaceAndWalletRecheck:true as const,requiresFullCheckedSimulationAndFinalWallet:true as const,notSignedOrExecuted:true as const,notWithdrawalEvidence:true as const}
}
