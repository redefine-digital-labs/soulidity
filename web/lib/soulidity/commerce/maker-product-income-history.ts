import type {SuiGrpcClient} from '@mysten/sui/grpc'
import type {PublicMutationPacket} from '../../sui/public-mutation-journal'
import {readFinalizedMutation} from '../../sui/finalized-mutation'
import {MAINNET_GENESIS_DIGEST} from '../../animacraft/mainnet-chain'
import {captureHistoricalExecutionFrameReaderV1, isQualifiedHistoricalEventFrameV1} from '../../sui/historical-execution-frame-v1'
import {captureIncomeOriginalLedger} from './income-original-ledger'
import {observeMakerIncomeExecutionV1, EMPTY_INCOME_EXECUTION_REGISTRY_V1, type IncomeExecutionRegistryV1} from './income-execution-source-v1'
import {incomeOriginalExecutionFacts} from './income-original-execution-facts'
import type {MakerProductIncomeTarget} from './maker-product-income-read'
import {assertMakerProductIncomePacket,proveMakerProductIncomeEffects,type MakerProductIncomeIntent} from './maker-product-income-proof'
export {IncomeWithdrawnBcs,type MakerProductIncomeIntent} from './maker-product-income-proof'
/** Original authenticated execution remains queryable without source/model
 * installation. Only qualified complete domain proofs may confirm payment. */
export async function readMakerProductIncomeHistory(input:{client:SuiGrpcClient;target:MakerProductIncomeTarget;packet:PublicMutationPacket;intent:MakerProductIncomeIntent;signal:AbortSignal;executionRegistry?:IncomeExecutionRegistryV1}){
 const saved=structuredClone({target:input.target,packet:input.packet,intent:input.intent}),client=captureIncomeOriginalLedger(input.client)
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(30000)]),registry=input.executionRegistry??EMPTY_INCOME_EXECUTION_REGISTRY_V1
 const reader=captureHistoricalExecutionFrameReaderV1({client,signal})
 const {gasWindow}=assertMakerProductIncomePacket(saved)
 const result=await readFinalizedMutation({client,packet:saved.packet,chainIdentifier:saved.target.chainIdentifier,genesisDigest:MAINNET_GENESIS_DIGEST,signal,minimumExecutionEpoch:gasWindow.min,errorPrefix:'MAKER_PRODUCT_INCOME_HISTORY',proveSuccess:async context=>{
  const executionContext={kind:'HISTORICAL_FINALIZED' as const,genesisDigest:MAINNET_GENESIS_DIGEST,transactionBytes:saved.packet.bytes,transactionDigest:saved.packet.digest,effects:context.effects,checkpoint:context.checkpoint}
  const frame=await observeMakerIncomeExecutionV1({client,signal,reader,registry,context:executionContext,target:saved.target})
  if(frame.status!=='QUALIFIED_EVENT_FRAME'||!isQualifiedHistoricalEventFrameV1(frame)) return {kind:'UNQUALIFIED_INCOME_EXECUTION' as const,qualification:frame,original:incomeOriginalExecutionFacts(executionContext,context.events)}
  const proof=await proveMakerProductIncomeEffects({...saved,client,signal,effects:context.effects,events:context.events,executionFrame:frame,executionCheckpoint:context.checkpoint})
  return {...proof,kind:'QUALIFIED_INCOME_WITHDRAWAL' as const,proof:'withdrawal-finalized-ledger-payment-gas' as const,requiresOriginalFinalityAndCheckpoint:false as const}
 }})
 if(result.status!=='SUCCEEDED') return result
 if(result.receipt.kind==='UNQUALIFIED_INCOME_EXECUTION') return {status:'FINALIZED_EXECUTION' as const,checkpoint:result.checkpoint,
  qualification:result.receipt.qualification,original:result.receipt.original,completeBusinessOutputVerified:false as const}
 return {...result,status:'WITHDRAWAL_EVIDENCE_CONFIRMED' as const,receipt:result.receipt}
}
