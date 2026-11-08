import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { CanonicalSoulBcs } from '../canonical-native-workbench'
import { NativePublicReadLinkV2Bcs } from '../native-public-read-record-v2'
import { readHistoricalOwnedBranchCandidate } from './historical-owned-branch-candidate'
import { commerceCheck, decodeCommerce } from './economics-read'
import { proveNativePublicReadPaidSoulHistoryV2 } from './native-public-read-paid-soul-history-v2'
const Pointer=bcs.struct('Field',{id:bcs.Address,name:bcs.struct('Wrapper',{name:bcs.struct('ModuleKey',{name:bcs.byteVector()})}),value:bcs.Address})

/** Actual original Link Object owner at original Soul snapshot. Two-edge
 * owned-root candidate, not qualification of deployed code or current access.
 * Rejects ancestor owner rebinding, failures and incomplete history. No live
 * object fallback and no Link-owner inference from committed preimage alone.
 */
export async function proveNativePublicReadPaidLinkHistoryV2(input:Parameters<typeof proveNativePublicReadPaidSoulHistoryV2>[0]){
 const saved=structuredClone({intent:input.intent,packet:input.packet,gas:input.gas,effects:input.effects,offer:input.offer,soulId:input.soulId,
  ledgerId:input.ledgerId,native:input.native,content:input.content,foundation:input.foundation,checkpoint:input.checkpoint,standard:input.standard,linkBytes:input.linkBytes})
 const source=input.client.ledgerService,signal=input.signal
 const client={ledgerService:{getObject:source.getObject.bind(source),getServiceInfo:source.getServiceInfo.bind(source),getTransaction:source.getTransaction.bind(source),getCheckpoint:source.getCheckpoint.bind(source)}} as unknown as typeof input.client
 const soul=await proveNativePublicReadPaidSoulHistoryV2({...saved,client,signal})
 const native=await readPinnedMovePackage(client,saved.native,signal),standard=await readPinnedMovePackage(client,saved.standard,signal)
 const type=(map:Map<string,string>,module:string,name:string)=>{const origin=map.get(`${module}::${name}`);commerceCheck(origin,'PUBLIC_PAID_V2_LINK_ORIGIN');return `${origin}::${module}::${name}`}
 const witness=type(native.origins,'birth','NativeModule'),wrapper=`0x2::dynamic_object_field::Wrapper<${type(standard.origins,'soul','ModuleKey')}<${witness}>>`
 const fieldId=deriveDynamicFieldID(saved.soulId,wrapper,bcs.byteVector().serialize(new TextEncoder().encode('native')).toBytes())
 commerceCheck(!saved.effects.V2!.changedObjects.some(([id])=>id===fieldId||id===soul.linkId),'PUBLIC_PAID_V2_LINK_CHANGED_DURING_BUY')
 const writer=await readHistoricalParentTransaction({client,transactionDigest:soul.writerTransactionDigest,maxCheckpoint:soul.writerCheckpoint,chainIdentifier:'35834a8a',genesisDigest:'4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',signal})
 commerceCheck(writer.executionStatus==='Success'&&writer.checkpoint===soul.writerCheckpoint,'PUBLIC_PAID_V2_LINK_WRITER')
 const soulType=type(standard.origins,'soul','Soul'),original=await readHistoricalMoveObject({client,effects:writer.effects,transactionDigest:writer.transactionDigest,objectId:saved.soulId,type:soulType,mode:'written',signal})
 commerceCheck(original.reference.version===soul.reference.version&&original.reference.digest===soul.reference.digest&&original.object.owner.ObjectOwner===soul.itemFieldId,'PUBLIC_PAID_V2_LINK_SOUL_REFERENCE')
 const root=decodeCommerce(CanonicalSoulBcs,original.bytes),descriptor=root.modules.find(d=>normalizeStructTag(d.namespace.name)===witness&&toHex(d.name)==='6e6174697665')!
 const history=await readHistoricalOwnedBranchCandidate({client,anchorEffects:writer.effects,anchorTransactionDigest:writer.transactionDigest,anchorCheckpoint:writer.checkpoint,anchorMode:'written',rootId:saved.soulId,rootType:soulType,rootOwnerId:soul.itemFieldId,
  branchId:fieldId,branchType:`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`,targetId:soul.linkId,targetType:type(native.origins,'birth','PublicReadLinkV2'),chainIdentifier:'35834a8a',genesisDigest:'4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',signal,
  assertRoot:bytes=>{const old=decodeCommerce(CanonicalSoulBcs,bytes),ds=old.modules.filter(d=>normalizeStructTag(d.namespace.name)===witness&&toHex(d.name)==='6e6174697665')
   commerceCheck(old.id===saved.soulId&&old.schema===1&&!old.editing&&BigInt(old.revision)<=BigInt(root.revision)&&publicMutationCanonical(old.origin)===publicMutationCanonical(root.origin)&&ds.length===1&&publicMutationCanonical(ds[0])===publicMutationCanonical(descriptor),'PUBLIC_PAID_V2_LINK_SOUL_ANCESTOR')},
  assertBranch:(bytes,id)=>{const pointer=decodeCommerce(Pointer,bytes);commerceCheck(pointer.id===fieldId&&toHex(pointer.name.name.name)==='6e6174697665'&&pointer.value===id,'PUBLIC_PAID_V2_LINK_POINTER')},
  assertTarget:bytes=>{const link=decodeCommerce(NativePublicReadLinkV2Bcs,bytes);commerceCheck(link.id===soul.linkId&&link.root===saved.soulId&&link.host===soul.hostId&&toHex(bytes)===toHex(saved.linkBytes),'PUBLIC_PAID_V2_LINK_VALUE')}})
 return {format:'native-public-read-v2' as const,proof:'original-link-object-owner-through-owned-soul-branch-candidate-only' as const,transactionDigest:saved.packet.digest,
  soulId:saved.soulId,hostId:soul.hostId,linkId:soul.linkId,moduleFieldId:fieldId,reference:history.reference,writerTransactionDigest:history.writerTransactionDigest,trail:history.trail,moduleTrail:history.branchTrail,
  requiresQualifiedSoulAndKioskParentCommitInvariants:true as const,requiresSharedHelperIndependentReview:true as const,requiresOriginalSourceQualification:true as const,
  notCurrentLink:true as const,notContentDeliveryProof:true as const}
}
