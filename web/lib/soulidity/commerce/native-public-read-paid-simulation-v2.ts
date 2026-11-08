import {bcs} from '@mysten/sui/bcs'
import {fromBase64,toBase64,toBase58} from '@mysten/sui/utils'
import {blake2b} from '@noble/hashes/blake2.js'
import {MAINNET_GENESIS_DIGEST} from '../../animacraft/mainnet-chain'
import type {PublicMutationPacket} from '../../sui/public-mutation-journal'
import {commerceCheck} from './economics-read'
import {assertNativePublicReadPaidPacketV2} from './native-public-read-paid-packet-v2'
import {proveNativePublicReadPaidReceiptV2} from './native-public-read-paid-receipt-v2'
import {proveNativePublicReadPaidMoneyV2} from './native-public-read-paid-money-v2'
import {proveNativePublicReadPaidEventsV2} from './native-public-read-paid-events-v2'
import {proveNativePublicReadPaidRegistryIdentityV2} from './native-public-read-paid-registry-identity-v2'
import {reconcileNativePublicReadPaidEffectsV2} from './native-public-read-paid-effects-v2'

/** NEW PREPARED packet only: explicit checks ENABLED/no Gas reselection.
 * Simulation ObjectSet is a scoped input/output witness, NEVER chain history.
 * No future-version ledger fallback, finality, durable receipt or delivery is
 * inferred. Parent still owes qualified source/current authority/full effects,
 * original journal exclusion and final wallet continuity before signing.
 */
export async function simulateNativePublicReadPaidPurchaseV2(input:Omit<Parameters<typeof proveNativePublicReadPaidReceiptV2>[0],'effects'|'packet'>&{
 packet:PublicMutationPacket;getBuyerAddress:()=>string|null}){
 const saved=structuredClone({intent:input.intent,packet:input.packet,gas:input.gas,offer:input.offer,soulId:input.soulId,ledgerId:input.ledgerId,native:input.native,content:input.content,foundation:input.foundation})
 const source=input.client,signal=AbortSignal.any([input.signal,AbortSignal.timeout(60000)]),getBuyerAddress=input.getBuyerAddress
 const ledger=source.ledgerService,execution=source.transactionExecutionService,simulate=execution.simulateTransaction.bind(execution)
 const getObject=ledger.getObject.bind(ledger),getInfo=ledger.getServiceInfo.bind(ledger),getEpoch=ledger.getEpoch.bind(ledger)
 const guard=()=>{signal.throwIfAborted();commerceCheck(getBuyerAddress()===saved.intent.buyer,'PUBLIC_PAID_V2_SIM_WALLET_CHANGED')}
 commerceCheck(saved.packet.phase==='PREPARED'&&saved.packet.signature===null,'PUBLIC_PAID_V2_SIM_NEW_PREPARED_ONLY')
 await assertNativePublicReadPaidPacketV2(saved.intent,saved.packet,saved.gas);guard()
 commerceCheck((await getInfo({}, {abort:signal})).response.chainId===MAINNET_GENESIS_DIGEST,'PUBLIC_PAID_V2_SIM_CHAIN');guard()
 const epoch=async()=>{const row=(await getEpoch({readMask:{paths:['epoch','reference_gas_price']}},{abort:signal})).response.epoch;guard()
  commerceCheck(typeof row?.epoch==='bigint'&&typeof row.referenceGasPrice==='bigint'&&row.referenceGasPrice>0n&&BigInt(saved.packet.expirationEpoch)>=row.epoch
   &&BigInt(saved.packet.expirationEpoch)<=row.epoch+1n&&BigInt(saved.gas.price)>=row.referenceGasPrice,'PUBLIC_PAID_V2_SIM_EPOCH_GAS');return row.epoch}
 const beforeEpoch=await epoch(),bytes=fromBase64(saved.packet.bytes)
 // Installed SDK protobuf enum TransactionChecks.ENABLED=0. Sending this
 // explicitly avoids inheriting the disabled readonly quote-query setting.
 const response=await simulate({transaction:{bcs:{value:bytes}},checks:0,doGasSelection:false,readMask:{paths:[
  'transaction.digest','transaction.transaction.bcs','transaction.effects.bcs','transaction.effects.transaction_digest','transaction.effects.status',
  'transaction.events.bcs','transaction.events.digest','transaction.objects','transaction.signatures','transaction.checkpoint',
 ]}},{abort:signal});guard()
 const raw=response.response.transaction,rows=raw?.objects?.objects
 commerceCheck(raw&&raw.digest===saved.packet.digest&&raw.transaction?.bcs?.value instanceof Uint8Array&&raw.transaction.bcs.value.length===bytes.length
  &&toBase64(raw.transaction.bcs.value)===saved.packet.bytes&&raw.checkpoint===undefined&&raw.signatures.length===0
  &&raw.effects?.bcs?.value instanceof Uint8Array&&raw.effects.bcs.value.length<=1024*1024
  &&raw.effects.transactionDigest===saved.packet.digest&&raw.effects.status?.success===true,'PUBLIC_PAID_V2_SIM_RAW_TRANSACTION')
 const effects=bcs.TransactionEffects.parse(raw.effects.bcs.value)
 commerceCheck(toBase64(bcs.TransactionEffects.serialize(effects).toBytes())===toBase64(raw.effects.bcs.value)&&effects.V2?.transactionDigest===saved.packet.digest
  &&effects.V2.status.$kind==='Success'&&BigInt(effects.V2.executedEpoch)===beforeEpoch,'PUBLIC_PAID_V2_SIM_EFFECTS')
 const rawEvents=raw.events?.bcs?.value
 commerceCheck(rawEvents instanceof Uint8Array&&rawEvents.length>0&&rawEvents.length<=1024*1024,'PUBLIC_PAID_V2_SIM_EVENTS')
 const events=new Uint8Array(rawEvents)
 const prefix=new TextEncoder().encode('TransactionEvents::'),preimage=new Uint8Array(prefix.length+events.length);preimage.set(prefix);preimage.set(events,prefix.length)
 const eventDigest=toBase58(blake2b(preimage,{dkLen:32}))
 commerceCheck(effects.V2.eventsDigest===eventDigest&&(!raw.events?.digest||raw.events.digest===eventDigest),'PUBLIC_PAID_V2_SIM_EVENT_DIGEST')
 commerceCheck(rows&&rows.length>0&&rows.length<=4096,'PUBLIC_PAID_V2_SIM_OBJECTS')
 let objectBytes=0;for(const row of rows){commerceCheck(row.bcs?.value instanceof Uint8Array&&row.bcs.value.length>0&&row.bcs.value.length<=8*1024*1024,'PUBLIC_PAID_V2_SIM_OBJECT_BYTES');objectBytes+=row.bcs.value.length}
 commerceCheck(objectBytes<=16*1024*1024,'PUBLIC_PAID_V2_SIM_OBJECT_BUDGET')
 const objects=new Map<string,(typeof rows)[number]>()
 for(const row of structuredClone(rows)){commerceCheck(row.objectId&&typeof row.version==='bigint'&&row.version>0n,'PUBLIC_PAID_V2_SIM_OBJECT_REFERENCE')
  const key=`${row.objectId}:${row.version}`;commerceCheck(!objects.has(key),'PUBLIC_PAID_V2_SIM_OBJECT_ALIAS');objects.set(key,row)}
 const packages=new Set([saved.native,saved.content,saved.foundation].map(p=>p.callablePackageId))
 // Reuse pure full-Object/effect verifiers against this explicitly scoped
 // simulation pool. They cannot fetch a simulated output from the ledger.
 const witnessClient={ledgerService:{getObject:async(request:Parameters<typeof getObject>[0],options?:Parameters<typeof getObject>[1])=>{
  guard();if(request.version===undefined){commerceCheck(packages.has(request.objectId!),'PUBLIC_PAID_V2_SIM_UNSCOPED_READ');const result=await getObject(request,options);guard();return result}
  const object=objects.get(`${request.objectId}:${request.version}`);commerceCheck(object,'PUBLIC_PAID_V2_SIM_MISSING_OBJECT_NO_LEDGER_FALLBACK')
  return {response:{object:structuredClone(object)}}
 }}} as unknown as typeof source
 const proofInput={...saved,client:witnessClient,signal,effects}
 const receipt=await proveNativePublicReadPaidReceiptV2(proofInput),money=await proveNativePublicReadPaidMoneyV2(proofInput)
 const eventProof=await proveNativePublicReadPaidEventsV2({client:witnessClient,content:saved.content,foundation:saved.foundation,soulId:saved.soulId,buyer:saved.intent.buyer,kind:saved.intent.kind,attempt:saved.intent.attempt,receipt,events,signal})
 const registryIdentity=await proveNativePublicReadPaidRegistryIdentityV2(proofInput)
 const inventory=reconcileNativePublicReadPaidEffectsV2({transactionDigest:saved.packet.digest,effects,receipt,money,registryIdentity,paidPointer:null,offerHistory:null,kioskCustody:null,authorizationHistory:null,soulHistory:null,modulePointerHistory:null,linkHistory:null})
 commerceCheck(await epoch()===beforeEpoch,'PUBLIC_PAID_V2_SIM_EPOCH_CHANGED');guard()
 return {format:'native-public-read-v2' as const,proof:'same-prepared-packet-checked-simulation-business-subproof-only' as const,transactionDigest:saved.packet.digest,
  checksRequested:'ENABLED' as const,gasReselection:false as const,simulation:{receipt,money,registryIdentity,events:eventProof,inventory},
  requiresQualifiedSourceAndCurrentAuthority:true as const,requiresCompleteEffectsAndFinalWalletJournal:true as const,notSigningQualification:true as const,
  notFinalizedReceipt:true as const,notContentDelivered:true as const}
}
