import { assertIncomeExecutionRegistrySupportsTargetV1, EMPTY_INCOME_EXECUTION_REGISTRY_V1, type IncomeExecutionRegistryV1 } from './income-execution-source-v1'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { setTransactionGasWindow } from '../../sui/transaction-gas-window'
import { requireMakerProductIncomeAddressGas } from './maker-product-income-gas'
import { captureMakerProductIncomeClient } from './maker-product-income-client'
import {bcs} from '@mysten/sui/bcs'
import {Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {fromBase58,toBase58,toBase64} from '@mysten/sui/utils'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {publicMutationCanonical} from '../../sui/public-mutation-journal'
import {readCommerceObject,decodeCommerce,commerceCheck,commerceId} from './economics-read'
import {readMakerProductIncome,parseMakerProductIncomeTarget,type MakerProductIncomeTarget} from './maker-product-income-read'
import {verifyMakerProductIncomeInterface} from './maker-product-income-interface'
import {buildMakerProductIncomeWithdrawal} from './maker-product-income-transaction'
import {createMakerProductIncomeRecoveryRecord} from './maker-product-income-recovery-record'
const MAX=18446744073709551615n,Coin=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()})
type Reference={objectId:string;version:string;digest:string}
/** NEW operation draft only, after main excludes prior active/unknown attempts.
 * No journal exclusion is performed or inferred here. No signing, gas selection,
 * broadcast, simulation, source adoption or permission to repeat old operations.
 */
export async function prepareMakerProductIncomeWithdrawal(input:{kind:'NEW_MAKER_PRODUCT_INCOME_WITHDRAWAL';client:SuiGrpcClient;target:MakerProductIncomeTarget;
 actor:string;controlId:string;recipient:string;amount:string;attempt:Uint8Array;reviewed:Awaited<ReturnType<typeof readMakerProductIncome>>;
 gas:{budget:string;price:string;coins:Reference[]};expirationEpoch:string;getActorAddress:()=>string|null;signal:AbortSignal;executionRegistry?:IncomeExecutionRegistryV1}){
 const {client:source,signal:parent,getActorAddress,executionRegistry=EMPTY_INCOME_EXECUTION_REGISTRY_V1,...values}=input,saved=structuredClone(values)
 const signal=AbortSignal.any([parent,AbortSignal.timeout(60000)]),client=captureMakerProductIncomeClient(source)
 saved.target=parseMakerProductIncomeTarget(saved.target)
 assertIncomeExecutionRegistrySupportsTargetV1(executionRegistry,saved.target)
 const guard=()=>{signal.throwIfAborted();commerceCheck(getActorAddress()===saved.actor,'MAKER_INCOME_PREPARE_WALLET_CHANGED')}
 const uint=(v:string)=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)&&BigInt(v)<=MAX
 commerceCheck(saved.kind==='NEW_MAKER_PRODUCT_INCOME_WITHDRAWAL'&&[saved.actor,saved.controlId,saved.recipient].every(commerceId)
  &&uint(saved.amount)&&uint(saved.gas.budget)&&uint(saved.gas.price)&&/^(0|[1-9][0-9]{0,15})$/.test(saved.expirationEpoch)&&Number.isSafeInteger(Number(saved.expirationEpoch))
  &&saved.attempt instanceof Uint8Array&&saved.attempt.length===32&&saved.attempt.some(v=>v!==0),'MAKER_INCOME_PREPARE_INPUT')
 const addressGas=saved.gas.coins.length===0
 commerceCheck(saved.gas.coins.length<=256&&new Set(saved.gas.coins.map(c=>c.objectId)).size===saved.gas.coins.length,'MAKER_INCOME_PREPARE_GAS')
 for(const ref of saved.gas.coins){commerceCheck(commerceId(ref.objectId)&&![saved.target.productId,saved.controlId].includes(ref.objectId)&&uint(ref.version)&&typeof ref.digest==='string'&&ref.digest.length<=64,'MAKER_INCOME_PREPARE_GAS_REF')
  const bytes=fromBase58(ref.digest);commerceCheck(bytes.length===32&&toBase58(bytes)===ref.digest,'MAKER_INCOME_PREPARE_GAS_REF')}
 guard()
 const request={client,target:saved.target,control:{actor:saved.actor,objectId:saved.controlId},signal}
 const observed=await readMakerProductIncome(request);guard()
 commerceCheck(publicMutationCanonical(observed)===publicMutationCanonical(saved.reviewed),'MAKER_INCOME_PREPARE_REVIEW_CHANGED')
 commerceCheck(BigInt(saved.amount)<=BigInt(observed.ledger.balance),'MAKER_INCOME_PREPARE_AMOUNT')
 const interfaceProof=await verifyMakerProductIncomeInterface({client,manufacturing:saved.target.manufacturing,signal});guard()
 const product=await readCommerceObject(client,saved.target.productId,observed.productType,signal);guard()
 commerceCheck(product.version===observed.object.version&&product.digest===observed.object.digest&&product.owner.Shared,'MAKER_INCOME_PREPARE_PRODUCT')
 const birth=product.owner.Shared!.initialSharedVersion
 async function epoch(){guard();const row=(await client.ledgerService.getEpoch({readMask:{paths:['epoch','reference_gas_price']}},{abort:signal})).response.epoch;guard()
  commerceCheck(typeof row?.epoch==='bigint'&&row.epoch>=0n&&row.epoch<=MAX&&typeof row.referenceGasPrice==='bigint'&&row.referenceGasPrice>0n&&row.referenceGasPrice<=MAX&&BigInt(saved.gas.price)>=row.referenceGasPrice,'MAKER_INCOME_PREPARE_EPOCH_OR_PRICE')
  const expiry=BigInt(saved.expirationEpoch)
  commerceCheck(expiry<=row.epoch+1n&&(addressGas?expiry===row.epoch+1n:expiry>=row.epoch),'MAKER_INCOME_PREPARE_EPOCH_OR_PRICE')
  return row.epoch
 }
 async function funds(){
  if(addressGas)return requireMakerProductIncomeAddressGas(client,saved.actor,getActorAddress,signal,saved.gas.budget)
  let sum=0n;for(const ref of saved.gas.coins){guard();const row=await readCommerceObject(client,ref.objectId,'0x2::coin::Coin<0x2::sui::SUI>',signal),coin=decodeCommerce(Coin,row.contents);guard()
  commerceCheck(row.version===ref.version&&row.digest===ref.digest&&row.owner.AddressOwner===saved.actor&&coin.id===ref.objectId,'MAKER_INCOME_PREPARE_GAS_COIN');sum+=BigInt(coin.balance)}
  commerceCheck(sum>=BigInt(saved.gas.budget)&&sum<=MAX,'MAKER_INCOME_PREPARE_GAS_BALANCE');return String(sum)}
 const gasEpoch=await epoch(),gasBalance=await funds()
 const tx=buildMakerProductIncomeWithdrawal(observed,{actor:saved.actor,recipient:saved.recipient,amount:saved.amount,attempt:saved.attempt})
 tx.setGasOwner(saved.actor);tx.setGasBudget(BigInt(saved.gas.budget));tx.setGasPrice(BigInt(saved.gas.price));tx.setGasPayment(saved.gas.coins)
 if(addressGas)setTransactionGasWindow(tx,MAINNET_GENESIS_DIGEST,gasEpoch)
 else tx.setExpiration({Epoch:Number(saved.expirationEpoch)})
 const bytes=await tx.build();guard()
 const packet={bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch:saved.expirationEpoch,phase:'PREPARED' as const,signature:null}
 const intent={actor:saved.actor,controlId:saved.controlId,recipient:saved.recipient,amount:saved.amount,revision:observed.ledger.revision,attempt:saved.attempt}
 const record=createMakerProductIncomeRecoveryRecord({target:saved.target,packet,intent}),gas=Transaction.from(bytes).getData().gasData
 commerceCheck(gas.owner===saved.actor&&gas.budget===saved.gas.budget&&gas.price===saved.gas.price&&publicMutationCanonical(gas.payment)===publicMutationCanonical(saved.gas.coins),'MAKER_INCOME_PREPARE_PACKET_GAS')
 const final=await readMakerProductIncome(request);guard();commerceCheck(publicMutationCanonical(final)===publicMutationCanonical(observed),'MAKER_INCOME_PREPARE_CHANGED')
 const finalProduct=await readCommerceObject(client,saved.target.productId,observed.productType,signal);guard()
 commerceCheck(finalProduct.version===product.version&&finalProduct.digest===product.digest&&finalProduct.owner.Shared?.initialSharedVersion===birth,'MAKER_INCOME_PREPARE_PRODUCT_CHANGED')
 await funds();await epoch();guard()
 return {record,packet,intent,interfaceProof,reviewed:final,reviewedGas:saved.gas,gasBalance,requiresMainDurableJournalAndOldOperationExclusion:true as const,
  requiresQualifiedSource:true as const,requiresFinalInterfaceAndWalletRecheck:true as const,requiresFullCheckedSimulationAndFinalWallet:true as const,notSignedOrExecuted:true as const,notWithdrawalEvidence:true as const}
}
