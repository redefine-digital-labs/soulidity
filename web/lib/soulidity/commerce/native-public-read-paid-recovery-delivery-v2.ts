import { toHex } from '@mysten/sui/utils'
import {readNativePublicReadPaidHistoryV2} from './native-public-read-paid-history-v2'
import {openReusableNativePublicReadContentV2} from './native-public-read-paid-delivery-v2'
import {readNativePublicReadPaidV2} from './native-public-read-paid-read-v2'
import {commerceCheck} from './economics-read'

import {paidContentScopeCovers} from './paid-content-policy'

type Delivery=Parameters<typeof openReusableNativePublicReadContentV2>[0]
type OpenDependencies=NonNullable<Parameters<typeof openReusableNativePublicReadContentV2>[1]>
export type PaidRecoveryAccessBasisV2 = 'ORIGINAL_ENTRY' | 'CURRENT_ENTRY' | 'CURRENT_OWNER'
/** Original saved V2 subscription recovery followed by CURRENT protected access.
 * Never reconstructs/submits payment or treats a historical Entry as authority.
 * Original settlement remains partial; content opened is not durable completion.
 */
export async function recoverNativePublicReadPaidContentV2(input:{history:Parameters<typeof readNativePublicReadPaidHistoryV2>[0];delivery:Delivery},
 dependencies:OpenDependencies&{history?:typeof readNativePublicReadPaidHistoryV2}={}){
 const h=input.history,q=input.delivery.qualification,p=input.delivery.protected,signal=q.signal,getAddress=p.getAddress
 commerceCheck(h.client===q.client&&h.signal===signal,'PUBLIC_PAID_V2_RECOVERY_CONTEXT')
 const source=q.client,ledger=source.ledgerService
 const client={cache:source.cache,core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core),getMoveFunction:source.core.getMoveFunction?.bind(source.core),
  listOwnedObjects:source.core.listOwnedObjects?.bind(source.core),resolveTransactionPlugin:source.core.resolveTransactionPlugin?.bind(source.core)},
  ledgerService:{getObject:ledger.getObject.bind(ledger),getTransaction:ledger.getTransaction.bind(ledger),getCheckpoint:ledger.getCheckpoint.bind(ledger),getServiceInfo:ledger.getServiceInfo.bind(ledger)}} as unknown as typeof source
 const {client:unusedClient,signal:unusedSignal,...historyData}=h
 const {client:unusedQClient,signal:unusedQSignal,...qualificationData}=q
 const saved=structuredClone(historyData),qualification={...structuredClone(qualificationData),client,signal}
 const protectedInput={...p,getAddress,sealConfig:structuredClone(p.sealConfig)}
 const history=dependencies.history??readNativePublicReadPaidHistoryV2,read=dependencies.read??readNativePublicReadPaidV2
 const openDependencies={openPaid:dependencies.openPaid,openOwner:dependencies.openOwner}
 const guard=()=>{signal.throwIfAborted();commerceCheck(getAddress()===qualification.buyer,'PUBLIC_PAID_V2_RECOVERY_WALLET_CHANGED')}
 guard()
 commerceCheck(qualification.format==='native-public-read-v2'&&saved.intent.format===qualification.format
  &&saved.intent.buyer===qualification.buyer&&saved.soulId===qualification.soulId&&saved.intent.kind===qualification.kind
  &&qualification.target.chainIdentifier==='35834a8a'&&qualification.target.registryId===saved.intent.registry.objectId
  &&qualification.target.configId===saved.intent.config.objectId
  &&saved.intent.nativeCallablePackageId===saved.native.callablePackageId
  &&saved.native.originalPackageId===qualification.target.native.originalPackageId
  &&saved.content.originalPackageId===qualification.target.content?.originalPackageId
  &&paidContentScopeCovers(BigInt(saved.offer.scope),qualification.requiredScope),
  'PUBLIC_PAID_V2_RECOVERY_SELECTION')
 const original=await history({...saved,client,signal,proveMoney:true});guard()
 if(original.status!=='SUBSCRIPTION_RECORDED')return {format:'native-public-read-v2' as const,status:'ORIGINAL_SUBSCRIPTION_NOT_CONFIRMED' as const,original,notContentDelivered:true as const,notPermissionToRetryPayment:true as const}
 commerceCheck(original.receipt.transactionDigest===saved.packet.digest&&original.receipt.money?.transactionDigest===saved.packet.digest
  &&paidContentScopeCovers(BigInt(original.receipt.entry.scope),qualification.requiredScope),'PUBLIC_PAID_V2_RECOVERY_ORIGINAL_SCOPE')
 const originalEntry = original.receipt.entryReference, originalEntryHash = toHex(original.receipt.receipt.entry_hash)
 function entryBasis(current: Awaited<ReturnType<typeof readNativePublicReadPaidV2>>): PaidRecoveryAccessBasisV2 {
  const ref = current.entryReference
  commerceCheck(ref && current.entryHash, 'PUBLIC_PAID_V2_RECOVERY_ENTRY_REQUIRED')
  if (ref.objectId !== originalEntry.objectId) return 'CURRENT_ENTRY'
  const distance = BigInt(ref.version) - BigInt(originalEntry.version)
  commerceCheck(distance >= 0n && (distance === 0n
    ? ref.digest === originalEntry.digest && current.entryHash === originalEntryHash
    : ref.digest !== originalEntry.digest), 'PUBLIC_PAID_V2_RECOVERY_ENTRY_LINEAGE')
  return distance === 0n ? 'ORIGINAL_ENTRY' : 'CURRENT_ENTRY'
 }
 const boundRead:typeof readNativePublicReadPaidV2=async request=>{
  guard();const current=await read(request);guard()
  commerceCheck(current.soulId===saved.soulId&&current.hostId===saved.intent.host.objectId&&current.ledgerId===saved.ledgerId
   &&current.stateId===original.receipt.stateId&&current.buyer===saved.intent.buyer&&current.kind===saved.intent.kind,'PUBLIC_PAID_V2_RECOVERY_CURRENT_BINDING')
  if (current.decision.action === 'REUSE_ENTRY') entryBasis(current)
  return current
 }
 const delivered=await openReusableNativePublicReadContentV2({qualification,protected:protectedInput},{...openDependencies,read:boundRead})
 try {
  guard()
  const accessBasis: PaidRecoveryAccessBasisV2 | null = delivered.status !== 'CONTENT_OPENED' ? null
    : delivered.accessPath === 'REUSE_OWNER' ? 'CURRENT_OWNER' : entryBasis(delivered.qualification)
  return {format:'native-public-read-v2' as const,status:delivered.status==='CONTENT_OPENED'?'ORIGINAL_SUBSCRIPTION_CONTENT_OPENED' as const:'ORIGINAL_SUBSCRIPTION_CURRENT_ACCESS_UNAVAILABLE' as const,
   original,delivery:delivered,accessBasis,notPermissionToRetryPayment:true as const,notDurablePurchaseCompletion:true as const,requiresQualifiedSourceAndFormatAdoption:true as const,notMainnetAcceptance:true as const}
 } catch (error) {
  if (delivered.status === 'CONTENT_OPENED') delivered.content.bytes.fill(0)
  throw error
 }
}
