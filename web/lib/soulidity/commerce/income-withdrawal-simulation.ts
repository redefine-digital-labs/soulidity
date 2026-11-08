import { captureSimulatedExecutionFrameReaderV1, isQualifiedSimulatedEventFrameV1 } from '../../sui/simulated-execution-frame-v1'
import { observeIncomeSimulatedExecutionV1, EMPTY_INCOME_EXECUTION_REGISTRY_V1, type IncomeExecutionRegistryV1 } from './income-execution-source-v1'
import {bcs} from '@mysten/sui/bcs'
import {Transaction} from '@mysten/sui/transactions'
import {fromBase64,toBase64,toBase58} from '@mysten/sui/utils'
import {blake2b} from '@noble/hashes/blake2.js'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {MAINNET_GENESIS_DIGEST} from '../../animacraft/mainnet-chain'
import {publicMutationCanonical} from '../../sui/public-mutation-journal'
import {commerceCheck,commerceId,type readEconomicsIncome} from './economics-read'
import {parseIncomeWithdrawalRecoveryRecord,incomeWithdrawalRecoveryProps} from './income-withdrawal-recovery-record'
import {verifyIncomeWithdrawalInterface} from './income-withdrawal-interface'
import {proveIncomeWithdrawalEffects,inspectUnqualifiedIncomeWithdrawalEffects} from './income-withdrawal-proof'

/** NEW PREPARED only, checks explicitly ENABLED and no Gas reselection.
 * The returned ObjectSet is a bounded simulation witness, never historical
 * ledger/finality. Original finalized recovery still needs original checkpoint.
 */
export async function simulateNewIncomeWithdrawal(input:{client:SuiGrpcClient;record:unknown;reviewedGas:{budget:string;price:string;coins:Array<{objectId:string;version:string;digest:string}>};getActorAddress:()=>string|null;signal:AbortSignal;executionRegistry?:IncomeExecutionRegistryV1}){
 const record=parseIncomeWithdrawalRecoveryRecord(input.record),gas=structuredClone(input.reviewedGas),saved=incomeWithdrawalRecoveryProps(record),source=input.client,ledger=source.ledgerService,execution=source.transactionExecutionService,getActorAddress=input.getActorAddress
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),getObject=ledger.getObject.bind(ledger),getEpoch=ledger.getEpoch.bind(ledger),getInfo=ledger.getServiceInfo.bind(ledger),simulate=execution.simulateTransaction.bind(execution)
 const client={core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core),getMoveFunction:source.core.getMoveFunction.bind(source.core)},ledgerService:{getObject,getEpoch,getServiceInfo:getInfo,getCheckpoint:ledger.getCheckpoint?.bind(ledger),getTransaction:ledger.getTransaction?.bind(ledger)}} as unknown as SuiGrpcClient
 const registry=input.executionRegistry??EMPTY_INCOME_EXECUTION_REGISTRY_V1,reader=captureSimulatedExecutionFrameReaderV1({client,signal})
 const guard=()=>{signal.throwIfAborted();commerceCheck(getActorAddress()===saved.intent.actor,'WITHDRAW_SIM_WALLET_CHANGED')}
 guard();commerceCheck(saved.packet.phase==='PREPARED'&&saved.packet.signature===null,'WITHDRAW_SIM_NEW_PREPARED_ONLY')
 const actualGas=Transaction.from(saved.packet.bytes).getData().gasData
 commerceCheck(actualGas.owner===saved.intent.actor&&actualGas.budget===gas.budget&&actualGas.price===gas.price&&BigInt(gas.budget)>0n&&BigInt(gas.price)>0n
  &&gas.coins.length>0&&gas.coins.length<=256&&publicMutationCanonical(actualGas.payment)===publicMutationCanonical(gas.coins)
  &&new Set(gas.coins.map(c=>c.objectId)).size===gas.coins.length&&gas.coins.every(c=>commerceId(c.objectId)&&![saved.target.configId,saved.intent.adminId].includes(c.objectId)&&BigInt(c.version)>0n),'WITHDRAW_SIM_REVIEWED_GAS')
 commerceCheck((await getInfo({},{abort:signal})).response.chainId===MAINNET_GENESIS_DIGEST,'WITHDRAW_SIM_CHAIN');guard()
 const epoch=async()=>{const row=(await getEpoch({readMask:{paths:['epoch','reference_gas_price','protocol_config']}},{abort:signal})).response.epoch;guard()
  commerceCheck(typeof row?.epoch==='bigint'&&row.epoch>=0n&&typeof row.referenceGasPrice==='bigint'&&row.referenceGasPrice>0n,'WITHDRAW_SIM_EPOCH_METADATA')
  commerceCheck(BigInt(saved.packet.expirationEpoch)>=row.epoch,'WITHDRAW_SIM_EXPIRED')
  commerceCheck(BigInt(saved.packet.expirationEpoch)<=row.epoch+1n,'WITHDRAW_SIM_FUTURE_EPOCH')
  commerceCheck(BigInt(gas.price)>=row.referenceGasPrice,'WITHDRAW_SIM_GAS_PRICE_CHANGED');return row.epoch}
 const beforeEpoch=await epoch(),bytes=fromBase64(saved.packet.bytes)
 const observed=await observeIncomeSimulatedExecutionV1({client,signal,reader,registry,target:saved.target,
  context:{kind:'SIMULATED',genesisDigest:MAINNET_GENESIS_DIGEST,transactionBytes:saved.packet.bytes,transactionDigest:saved.packet.digest},
  simulate:async scoped=>{
   const received=await simulate({transaction:{bcs:{value:bytes}},checks:0,doGasSelection:false,readMask:{paths:[
  'transaction.digest','transaction.transaction.bcs','transaction.effects.bcs','transaction.effects.transaction_digest','transaction.effects.status',
  'transaction.events.bcs','transaction.events.digest','transaction.objects','transaction.signatures','transaction.checkpoint',
 ]}},{abort:scoped});
   // Snapshot only the protobuf data before any caller callback or await.
   // FinishedUnaryCall.method contains non-cloneable reflection functions.
   const value={response:structuredClone(received.response)};guard()
   const rawEffects=value.response.transaction?.effects?.bcs?.value
   commerceCheck(rawEffects instanceof Uint8Array&&rawEffects.length>0&&rawEffects.length<=1024*1024,'WITHDRAW_SIM_RAW_EFFECTS_BOUND')
   return {value,effects:bcs.TransactionEffects.parse(rawEffects)}
  }})
 const response=observed.value;guard()
 const raw=response.response.transaction,rows=raw?.objects?.objects
 commerceCheck(raw&&raw.digest===saved.packet.digest&&raw.transaction?.bcs?.value instanceof Uint8Array&&raw.transaction.bcs.value.length===bytes.length
  &&toBase64(raw.transaction.bcs.value)===saved.packet.bytes&&raw.checkpoint===undefined&&raw.signatures.length===0
  &&raw.effects?.bcs?.value instanceof Uint8Array&&raw.effects.bcs.value.length<=1024*1024&&raw.effects.transactionDigest===saved.packet.digest&&raw.effects.status?.success===true,'WITHDRAW_SIM_RAW')
 const effects=structuredClone(bcs.TransactionEffects.parse(raw.effects.bcs.value))
 commerceCheck(toBase64(bcs.TransactionEffects.serialize(effects).toBytes())===toBase64(raw.effects.bcs.value)&&effects.V2?.transactionDigest===saved.packet.digest
  &&effects.V2.status.$kind==='Success'&&BigInt(effects.V2.executedEpoch)===beforeEpoch,'WITHDRAW_SIM_EFFECTS')
 const rawEvents=raw.events?.bcs?.value
 commerceCheck(rawEvents instanceof Uint8Array&&rawEvents.length>0&&rawEvents.length<=1024*1024,'WITHDRAW_SIM_EVENTS');const events=new Uint8Array(rawEvents)
 const prefix=new TextEncoder().encode('TransactionEvents::'),preimage=new Uint8Array(prefix.length+events.length);preimage.set(prefix);preimage.set(events,prefix.length)
 const eventDigest=toBase58(blake2b(preimage,{dkLen:32}))
 commerceCheck(effects.V2.eventsDigest===eventDigest&&(!raw.events?.digest||raw.events.digest===eventDigest),'WITHDRAW_SIM_EVENT_DIGEST')
 commerceCheck(rows&&rows.length>0&&rows.length<=4096,'WITHDRAW_SIM_OBJECTS')
 let total=0;for(const row of rows){commerceCheck(row.bcs?.value instanceof Uint8Array&&row.bcs.value.length>0&&row.bcs.value.length<=8*1024*1024,'WITHDRAW_SIM_OBJECT_BYTES');total+=row.bcs.value.length}
 commerceCheck(total<=16*1024*1024,'WITHDRAW_SIM_OBJECT_BUDGET')
 const objects=new Map<string,(typeof rows)[number]>()
 for(const row of structuredClone(rows)){commerceCheck(commerceId(row.objectId!)&&typeof row.version==='bigint'&&row.version>0n,'WITHDRAW_SIM_OBJECT_REF');const key=`${row.objectId}:${row.version}`;commerceCheck(!objects.has(key),'WITHDRAW_SIM_OBJECT_ALIAS');objects.set(key,row)}
 const interfaceProof=await verifyIncomeWithdrawalInterface({client,foundation:saved.target.foundation,signal});guard()
 const witnessClient={ledgerService:{getObject:async(request:Parameters<typeof getObject>[0],options?:Parameters<typeof getObject>[1])=>{
  guard();if(request.version===undefined){commerceCheck(request.objectId===saved.target.foundation.callablePackageId,'WITHDRAW_SIM_UNSCOPED_READ');const result=await getObject(request,options);guard();return result}
  const object=objects.get(`${request.objectId}:${request.version}`);commerceCheck(object,'WITHDRAW_SIM_MISSING_OBJECT_NO_LEDGER_FALLBACK');return {response:{object:structuredClone(object)}}
 }}} as unknown as SuiGrpcClient
 const qualified=observed.observation.status==='QUALIFIED_SIMULATED_EVENT_FRAME'&&isQualifiedSimulatedEventFrameV1(observed.observation)
 const proof=qualified?await proveIncomeWithdrawalEffects({...saved,client:witnessClient,signal,effects,events,executionFrame:observed.observation as Extract<typeof observed.observation,{status:'QUALIFIED_SIMULATED_EVENT_FRAME'}>}):await inspectUnqualifiedIncomeWithdrawalEffects({...saved,client:witnessClient,signal,effects,events})
 commerceCheck(await epoch()===beforeEpoch,'WITHDRAW_SIM_EPOCH_CHANGED');guard()
 return {simulationVerified:qualified,executionModel:observed.observation,proof:'same-prepared-withdrawal-checked-simulation-only' as const,transactionDigest:saved.packet.digest,checksRequested:'ENABLED' as const,gasReselection:false as const,
  interfaceProof,simulation:proof,requiresQualifiedSourceAndCurrentAuthority:true as const,requiresMainDurableJournalAndFinalWallet:true as const,
  notSigningQualification:true as const,notFinalizedWithdrawalEvidence:true as const,notPaid:true as const}
}

/** Bind authenticated simulated inputs to the separately reviewed current state.
 * Neither equality nor simulation proves later signing-time authority/finality. */
export function assertIncomeWithdrawalSimulationInputs(simulation:Awaited<ReturnType<typeof simulateNewIncomeWithdrawal>>,reviewed:Awaited<ReturnType<typeof readEconomicsIncome>>){
 commerceCheck(simulation.simulationVerified===true,'WITHDRAW_SIM_EXECUTION_MODEL_UNQUALIFIED')
 commerceCheck(publicMutationCanonical(simulation.simulation.inputConfig)===publicMutationCanonical(reviewed.object)
  &&reviewed.authority&&publicMutationCanonical(simulation.simulation.inputAdmin)===publicMutationCanonical({objectId:reviewed.authority.objectId,version:reviewed.authority.version,digest:reviewed.authority.digest}),'WITHDRAW_SIMULATION_INPUT_CHANGED')
}
