import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readHistoricalParentTransaction } from '../../sui/historical-parent-lineage'
import { readHistoricalChildThroughOwnedParent } from '../../sui/historical-owned-parent'
import { CanonicalSoulBcs } from '../canonical-native-workbench'
import { commerceCheck, decodeCommerce } from './economics-read'
import { proveNativePublicReadPaidSoulHistoryV2 } from './native-public-read-paid-soul-history-v2'
const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: bcs.struct('ModuleKey', { name: bcs.byteVector() }) }), value: bcs.Address })

/** Original module pointer under the exact Soul snapshot authenticated through
 * readonly Kiosk history. This does NOT prove the Link Object's owner at that
 * snapshot. The owned Soul walker rejects Item-owner rebinding, including
 * incomplete pre-resale history; errors never become current fallback/absence.
 */
export async function proveNativePublicReadPaidModulePointerHistoryV2(input: Parameters<typeof proveNativePublicReadPaidSoulHistoryV2>[0]) {
  const saved = structuredClone({ intent: input.intent, packet: input.packet, gas: input.gas, effects: input.effects, offer: input.offer,
    soulId: input.soulId, ledgerId: input.ledgerId, native: input.native, content: input.content, foundation: input.foundation,
    checkpoint: input.checkpoint, standard: input.standard, linkBytes: input.linkBytes })
  const { signal } = input, source = input.client.ledgerService
  const client = { ledgerService: { getServiceInfo: source.getServiceInfo.bind(source), getTransaction: source.getTransaction.bind(source),
    getCheckpoint: source.getCheckpoint.bind(source), getObject: source.getObject.bind(source) } } as unknown as typeof input.client
  const soul = await proveNativePublicReadPaidSoulHistoryV2({ ...saved, client, signal })
  const native = await readPinnedMovePackage(client,saved.native,signal), standard = await readPinnedMovePackage(client,saved.standard,signal)
  const type = (origins: Map<string,string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin,'PUBLIC_PAID_V2_MODULE_POINTER_ORIGIN');return `${origin}::${module}::${name}` }
  const witness=type(native.origins,'birth','NativeModule'), wrapper=`0x2::dynamic_object_field::Wrapper<${type(standard.origins,'soul','ModuleKey')}<${witness}>>`
  const name=new TextEncoder().encode('native'), fieldId=deriveDynamicFieldID(saved.soulId,wrapper,bcs.byteVector().serialize(name).toBytes())
  commerceCheck(!saved.effects.V2!.changedObjects.some(([id])=>id===fieldId || id===soul.linkId),'PUBLIC_PAID_V2_MODULE_POINTER_CHANGED')
  const writer=await readHistoricalParentTransaction({client,transactionDigest:soul.writerTransactionDigest,maxCheckpoint:soul.writerCheckpoint,
    chainIdentifier:'35834a8a',genesisDigest:'4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',signal})
  commerceCheck(writer.executionStatus==='Success' && writer.checkpoint===soul.writerCheckpoint,'PUBLIC_PAID_V2_MODULE_POINTER_WRITER')
  const soulType=type(standard.origins,'soul','Soul'), original=await readHistoricalMoveObject({client,effects:writer.effects,
    transactionDigest:writer.transactionDigest,objectId:saved.soulId,type:soulType,mode:'written',signal})
  commerceCheck(original.reference.version===soul.reference.version && original.reference.digest===soul.reference.digest
    && original.object.owner.ObjectOwner===soul.itemFieldId,'PUBLIC_PAID_V2_MODULE_POINTER_SOUL_REFERENCE')
  const anchor=decodeCommerce(CanonicalSoulBcs,original.bytes)
  const descriptor=anchor.modules.find(d=>normalizeStructTag(d.namespace.name)===witness && toHex(d.name)==='6e6174697665')!
  const child=await readHistoricalChildThroughOwnedParent({client,anchorEffects:writer.effects,anchorTransactionDigest:writer.transactionDigest,
    anchorCheckpoint:writer.checkpoint,anchorMode:'written',rootId:saved.soulId,rootType:soulType,rootOwnerId:soul.itemFieldId,
    childId:fieldId,childType:`0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`,signal,chainIdentifier:'35834a8a',
    genesisDigest:'4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',assertRoot:bytes=>{const root=decodeCommerce(CanonicalSoulBcs,bytes)
      const descriptors=root.modules.filter(d=>normalizeStructTag(d.namespace.name)===witness && toHex(d.name)==='6e6174697665')
      commerceCheck(root.id===saved.soulId && root.schema===1 && !root.editing && BigInt(root.revision)<=BigInt(anchor.revision)
        && descriptors.length===1 && descriptors[0].object===soul.linkId && descriptors[0].schema===2 && !descriptors[0].removable
        && normalizeStructTag(descriptors[0].value_type.name)===normalizeStructTag(descriptor.value_type.name)
        && toHex(descriptors[0].body_hash)===toHex(descriptor.body_hash) && toHex(descriptors[0].semantic_hash)===toHex(descriptor.semantic_hash),
      'PUBLIC_PAID_V2_MODULE_POINTER_SOUL_ANCESTOR')
    }})
  const field=decodeCommerce(Field,child.bytes)
  commerceCheck(field.id===fieldId && toHex(field.name.name.name)==='6e6174697665' && field.value===soul.linkId,'PUBLIC_PAID_V2_MODULE_POINTER_FIELD')
  return {format:'native-public-read-v2' as const,proof:'original-schema2-module-pointer-through-owned-soul-history-only' as const,
    transactionDigest:saved.packet.digest,soulId:saved.soulId,linkId:soul.linkId,hostId:soul.hostId,fieldId,
    soulReference:soul.reference,writerTransactionDigest:child.writerTransactionDigest,trail:child.trail,
    requiresOriginalLinkObjectOwnershipProof:true as const,requiresQualifiedSoulParentCommitInvariant:true as const,
    requiresSharedHelperIndependentReview:true as const,notCurrentLink:true as const,notContentDeliveryProof:true as const}
}
