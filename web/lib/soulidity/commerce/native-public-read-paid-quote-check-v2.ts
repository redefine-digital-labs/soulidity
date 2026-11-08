import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64, toHex, normalizeStructTag, fromBase58, toBase58 } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { PinnedMovePackage } from '../../sui/pinned-move-package'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { commerceCheck, commerceId, readCommerceObject } from './economics-read'
import { verifyNativePublicReadPaidV2Interfaces } from './native-public-read-paid-interface-v2'
import { buildNativePublicReadPaidQuoteV2, type NativePublicReadPaidQuoteV2 } from './native-public-read-paid-transaction-v2'
type Reference={objectId:string;version:string;digest:string}

/** Actual quote query only. Checks are disabled solely for no-Gas dev-inspect;
 * this is NOT the checked full purchase simulation or signing qualification.
 * Original signed/unknown recovery never calls this current-state adapter.
 */
export async function checkNativePublicReadPaidQuoteV2(input:{client:SuiGrpcClient;native:PinnedMovePackage;foundation:PinnedMovePackage;
 intent:NativePublicReadPaidQuoteV2;sender:string;expected:{hash:Uint8Array;total:string};hostReference:Reference;configReference:Reference;signal:AbortSignal}){
 const saved=structuredClone({native:input.native,foundation:input.foundation,intent:input.intent,sender:input.sender,expected:input.expected,hostReference:input.hostReference,configReference:input.configReference})
 const source=input.client,signal=AbortSignal.any([input.signal,AbortSignal.timeout(45000)])
 const client={core:{getChainIdentifier:source.core.getChainIdentifier.bind(source.core),getMoveFunction:source.core.getMoveFunction.bind(source.core),simulateTransaction:source.core.simulateTransaction.bind(source.core),resolveTransactionPlugin:source.core.resolveTransactionPlugin?.bind(source.core)},ledgerService:{getObject:source.ledgerService.getObject.bind(source.ledgerService)}} as unknown as SuiGrpcClient
 const {intent:p,expected}=saved
 commerceCheck(commerceId(saved.sender)&&p.nativeCallablePackageId===saved.native.callablePackageId&&expected.hash instanceof Uint8Array&&expected.hash.length===32
  &&/^[1-9][0-9]{0,19}$/.test(expected.total)&&BigInt(expected.total)<=(1n<<64n)-1n,'PUBLIC_PAID_V2_QUOTE_CHECK_INPUT')
 for(const [ref,shared] of [[saved.hostReference,p.host],[saved.configReference,p.config]] as const){
  let digest=false;try{digest=fromBase58(ref.digest).length===32&&toBase58(fromBase58(ref.digest))===ref.digest}catch{}
  commerceCheck(ref.objectId===shared.objectId&&/^[1-9][0-9]{0,19}$/.test(ref.version)&&BigInt(ref.version)<=(1n<<64n)-1n&&digest,'PUBLIC_PAID_V2_QUOTE_CHECK_REFERENCE')
 }
 const tx=buildNativePublicReadPaidQuoteV2(p);tx.setSender(saved.sender)
 const kind=await tx.build({onlyTransactionKind:true})
 const interfaces=await verifyNativePublicReadPaidV2Interfaces({client,native:saved.native,foundation:saved.foundation,signal})
 const foundation=await readPinnedMovePackage(client,saved.foundation,signal),configOrigin=foundation.origins.get('economics::Config')
 commerceCheck(configOrigin,'PUBLIC_PAID_V2_QUOTE_CHECK_CONFIG_ORIGIN')
 const observe=async()=>{
  for(const [ref,type,birth] of [[saved.hostReference,interfaces.hostType,p.host.initialSharedVersion],[saved.configReference,`${configOrigin}::economics::Config<${normalizeStructTag(p.coinType)}>`,p.config.initialSharedVersion]] as const){
   const object=await readCommerceObject(client,ref.objectId,type,signal)
   commerceCheck(object.version===ref.version&&object.digest===ref.digest&&object.owner.Shared?.initialSharedVersion===birth,'PUBLIC_PAID_V2_QUOTE_CHECK_SNAPSHOT_CHANGED')
  }
 }
 await observe();signal.throwIfAborted()
 const result=await client.core.simulateTransaction({transaction:tx,checksEnabled:false,include:{bcs:true,effects:true,commandResults:true},signal})
 signal.throwIfAborted()
 commerceCheck(result.$kind==='Transaction'&&result.Transaction.status.success&&result.Transaction.effects.status.success,'PUBLIC_PAID_V2_QUOTE_CHECK_FAILED')
 const raw=result.Transaction.bcs,rawEffects=result.Transaction.effects.bcs
 commerceCheck(raw instanceof Uint8Array&&raw.length>0&&raw.length<=1024*1024&&rawEffects instanceof Uint8Array&&rawEffects.length>0&&rawEffects.length<=1024*1024,'PUBLIC_PAID_V2_QUOTE_CHECK_RAW')
 const parsed=bcs.TransactionData.parse(raw),effects=bcs.TransactionEffects.parse(rawEffects),digest=TransactionDataBuilder.getDigestFromBytes(raw)
 commerceCheck(toBase64(bcs.TransactionData.serialize(parsed).toBytes())===toBase64(raw)&&parsed.V1?.sender===saved.sender
  &&toBase64(bcs.TransactionKind.serialize(parsed.V1.kind).toBytes())===toBase64(kind)
  &&parsed.V1.gasData.payment.length===0,'PUBLIC_PAID_V2_QUOTE_CHECK_TRANSACTION')
 commerceCheck(toBase64(bcs.TransactionEffects.serialize(effects).toBytes())===toBase64(rawEffects)&&effects.V2?.status.$kind==='Success'
  &&effects.V2.transactionDigest===digest&&result.Transaction.digest===digest&&result.Transaction.effects.transactionDigest===digest
  &&effects.V2.changedObjects.length<=4096&&effects.V2.unchangedConsensusObjects.length<=4096
  &&new Set(effects.V2.changedObjects.map(([id])=>id)).size===effects.V2.changedObjects.length
  &&new Set(effects.V2.unchangedConsensusObjects.map(([id])=>id)).size===effects.V2.unchangedConsensusObjects.length
  &&effects.V2.unchangedConsensusObjects.every(([id])=>!effects.V2!.changedObjects.some(([other])=>id===other)),'PUBLIC_PAID_V2_QUOTE_CHECK_EFFECTS')
 for(const ref of [saved.hostReference,saved.configReference]){
  const row=effects.V2.unchangedConsensusObjects.find(([id])=>id===ref.objectId)?.[1].ReadOnlyRoot
  commerceCheck(row?.[0]===ref.version&&row[1]===ref.digest&&!effects.V2.changedObjects.some(([id])=>id===ref.objectId),'PUBLIC_PAID_V2_QUOTE_CHECK_READONLY_ROOT')
 }
 commerceCheck(result.commandResults?.length===1&&result.commandResults[0].returnValues.length===2&&result.commandResults[0].mutatedReferences.length===0,'PUBLIC_PAID_V2_QUOTE_CHECK_RETURNS')
 const [hashBytes,totalBytes]=result.commandResults[0].returnValues.map(v=>v.bcs)
 commerceCheck(hashBytes instanceof Uint8Array&&hashBytes.length===33&&totalBytes instanceof Uint8Array&&totalBytes.length===8,'PUBLIC_PAID_V2_QUOTE_CHECK_RETURN_BCS')
 const hash=bcs.byteVector().parse(hashBytes),total=bcs.u64().parse(totalBytes)
 commerceCheck(toBase64(bcs.byteVector().serialize(hash).toBytes())===toBase64(hashBytes)&&hash.length===32
  &&toHex(hash)===toHex(expected.hash)&&total===expected.total,'PUBLIC_PAID_V2_QUOTE_CHECK_MISMATCH')
 await observe();signal.throwIfAborted()
 return {format:'native-public-read-v2' as const,kindBytes:kind,contractQuote:{hash:new Uint8Array(hash),total},hostReference:saved.hostReference,configReference:saved.configReference,
  queryChecks:'DISABLED_READONLY_DEV_INSPECT' as const,interfaces,requiresQualifiedSourceAndFormatAdoption:true as const,requiresCurrentSelectedRecordAndEntryQualification:true as const,requiresFullPurchaseFundingAndCheckedSimulation:true as const,
  notSigningQualification:true as const,notFinalizedReceipt:true as const,notDeliveryProof:true as const}
}
