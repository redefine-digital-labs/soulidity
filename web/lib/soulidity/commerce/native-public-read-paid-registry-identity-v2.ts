import {readPinnedMovePackage} from '../../sui/pinned-move-package'
import {readHistoricalMoveObject} from '../../sui/historical-object'
import {assertNativePublicReadPaidPacketV2} from './native-public-read-paid-packet-v2'
import type {proveNativePublicReadPaidReceiptV2} from './native-public-read-paid-receipt-v2'
import {commerceCheck} from './economics-read'

/** Typed readonly Registry OBJECT identity at supplied original effects (or an
 * explicitly scoped simulation witness). This does not decode Registry source,
 * authority or economic-gate fields, establish finality or grant permission.
 */
export async function proveNativePublicReadPaidRegistryIdentityV2(input:Parameters<typeof proveNativePublicReadPaidReceiptV2>[0]){
 const saved=structuredClone({intent:input.intent,packet:input.packet,gas:input.gas,effects:input.effects,native:input.native})
 const signal=input.signal,source=input.client.ledgerService,client={ledgerService:{getObject:source.getObject.bind(source)}} as unknown as typeof input.client
 await assertNativePublicReadPaidPacketV2(saved.intent,saved.packet,saved.gas)
 const native=await readPinnedMovePackage(client,saved.native,signal),origin=native.origins.get('registry::Registry')
 commerceCheck(origin&&native.pin.callablePackageId===saved.intent.nativeCallablePackageId,'PUBLIC_PAID_V2_REGISTRY_ORIGIN')
 const registry=saved.intent.registry
 const object=await readHistoricalMoveObject({client,effects:saved.effects,transactionDigest:saved.packet.digest,objectId:registry.objectId,
  type:`${origin}::registry::Registry`,mode:'readonly',signal})
 commerceCheck(object.object.owner.Shared?.initialSharedVersion===registry.initialSharedVersion,'PUBLIC_PAID_V2_REGISTRY_BIRTH')
 return {format:'native-public-read-v2' as const,proof:'typed-readonly-registry-object-identity-only' as const,transactionDigest:saved.packet.digest,
  registryId:registry.objectId,reference:object.reference,initialSharedVersion:registry.initialSharedVersion,observedReadOnlyIds:[registry.objectId],
  requiresOriginalRegistrySourceAuthorityAndEconomicFields:true as const,requiresParentFinalityOrExplicitSimulationScope:true as const,
  notAuthorityProof:true as const,notCurrentSourceQualification:true as const,notContentDeliveryProof:true as const}
}
