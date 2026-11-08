import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { bcs } from '@mysten/sui/bcs'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readHistoricalChildThroughParent } from '../../sui/historical-parent-lineage'
import { readHistoricalChildThroughOwnedParent } from '../../sui/historical-owned-parent'
import { moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { CanonicalNativeStateBcs, CanonicalSoulBcs } from '../canonical-native-workbench'
import { EconomicsConfigBcs, NativeOfferBcs, recoverEconomicsHistoricalGates } from './economics-bcs'
import { NativeSaleRegistryBcs, NativeSaleSourceLocationBcs } from './native-sale-source-binding'
import { assertNativeSaleGraph, parseNativeSaleGraphPlan, type NativeSaleGraphPlan } from './native-sale-graph'
import { commerceCheck, decodeCommerce } from './economics-read'
import { nativeSaleSoulManifest } from './native-sale-tree'

const CollectionField = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('CollectionKey', { dummy_field: bcs.bool() }), value: bcs.Address })

/** Original lawful-resale source identity, not today's issuance policy.
 * Parent authenticates finality. Optional Standard pin binds the original
 * Soul module/body; custody and executed qualification remain separate.
 */
export async function proveHistoricalSaleSourceBinding(input: {
  client: SuiGrpcClient; plan: NativeSaleGraphPlan; packet: { bytes: string; digest: string };
  effects: Parameters<typeof readHistoricalMoveObject>[0]['effects']; checkpoint: string;
  native: PinnedMovePackage; foundation: PinnedMovePackage; standard?: PinnedMovePackage; signal: AbortSignal
}) {
  const plan = parseNativeSaleGraphPlan(input.plan), effects = structuredClone(input.effects), packet = structuredClone(input.packet)
  const nativePin = structuredClone(input.native), foundationPin = structuredClone(input.foundation), standardPin = input.standard && structuredClone(input.standard)
  const { client, signal, checkpoint } = input
  assertNativeSaleGraph(plan, packet)
  commerceCheck(effects.V2?.status.$kind === 'Success' && effects.V2.transactionDigest === packet.digest, 'SALE_ORIGINAL_SOURCE_CONTEXT')
  const native = await readPinnedMovePackage(client, nativePin, signal), foundation = await readPinnedMovePackage(client, foundationPin, signal)
  const link = native.linkage.get(foundation.pin.originalPackageId)
  commerceCheck(native.pin.callablePackageId === plan.callablePackageId && link?.upgradedId === foundation.pin.callablePackageId
    && link.upgradedVersion === String(foundation.version), 'SALE_ORIGINAL_SOURCE_LINK')
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'SALE_ORIGINAL_SOURCE_ORIGIN'); return `${origin}::${module}::${name}` }
  const read = (objectId: string, type: string, mode: 'input' | 'readonly') => readHistoricalMoveObject({ client, effects,
    transactionDigest: packet.digest, objectId, type, mode, signal, maxBytes: 256 * 1024 })
  const offer = decodeCommerce(NativeOfferBcs, (await read(plan.offerId, type(native.origins, 'market', 'Offer'), 'input')).bytes)
  commerceCheck(offer.id === plan.offerId && offer.root === plan.soulId && offer.registry === plan.registryId
    && offer.config === plan.configId && offer.collection === plan.collectionId && offer.active && offer.purchase, 'SALE_ORIGINAL_SOURCE_OFFER')
  const stateObject = await read(offer.state, type(native.origins, 'birth', 'State'), 'input'), state = decodeCommerce(CanonicalNativeStateBcs, stateObject.bytes)
  commerceCheck(stateObject.object.owner.ObjectOwner && state.id === offer.state && state.root === plan.soulId && state.protocol === plan.configId && state.registry === plan.registryId
    && state.schema === 1 && state.creator === offer.creator && state.creator_royalty_bps === offer.royalty, 'SALE_ORIGINAL_SOURCE_STATE')
  let soulBinding: { soulId: string; stateFieldId: string; soulVersion: string; soulDigest: string; rootRevision: string; manifestHex: string } | null = null
  if (standardPin) {
    const standard = await readPinnedMovePackage(client, standardPin, signal), dependency = native.linkage.get(standard.pin.originalPackageId)
    commerceCheck(dependency?.upgradedId === standard.pin.callablePackageId && dependency.upgradedVersion === String(standard.version), 'SALE_ORIGINAL_SOURCE_STANDARD_LINK')
    const soulObject = await read(plan.soulId, type(standard.origins, 'soul', 'Soul'), 'input'), soul = decodeCommerce(CanonicalSoulBcs, soulObject.bytes)
    const witness = type(native.origins, 'birth', 'NativeModule'), stateType = type(native.origins, 'birth', 'State')
    commerceCheck(soul.id === plan.soulId && soul.schema === 1 && !soul.editing && soul.modules.length <= 64 && BigInt(soul.revision) > 0n, 'SALE_ORIGINAL_SOURCE_SOUL')
    const manifestHex = toHex(nativeSaleSoulManifest(soulObject.bytes))
    commerceCheck(soul.revision === offer.root_revision && manifestHex === toHex(offer.manifest)
      && state.creator === soul.origin.minted_by && state.provenance.kind <= 2, 'SALE_ORIGINAL_SOURCE_OFFER_SNAPSHOT')
    // Collection source admission checks Standard Origin identity; the minimal
    // Standard Soul has no separate Collection business field. The reciprocal
    // private ID is in Native State, and permanent membership is in Collection.
    commerceCheck(soul.origin.source === plan.registryId
      && normalizeStructTag(soul.origin.source_type.name) === type(native.origins, 'registry', 'Registry')
      && normalizeStructTag(soul.origin.producer.name) === type(native.origins, 'registry', 'SoulProducer'), 'SALE_ORIGINAL_SOURCE_ORIGIN_IDENTITY')
    const descriptors = soul.modules.filter(d => normalizeStructTag(d.namespace.name) === witness && toHex(d.name) === '6e6174697665')
    commerceCheck(descriptors.length === 1, 'SALE_ORIGINAL_SOURCE_DESCRIPTOR_COUNT')
    const d = descriptors[0], moduleKey = type(standard.origins, 'soul', 'ModuleKey')
    const stateFieldId = deriveDynamicFieldID(soul.id, `0x2::dynamic_object_field::Wrapper<${moduleKey}<${witness}>>`, bcs.byteVector().serialize(d.name).toBytes())
    commerceCheck(d.object === state.id && d.schema === 1 && !d.removable && normalizeStructTag(d.value_type.name) === stateType
      && toHex(d.body_hash) === toHex(sha3_256(stateObject.bytes)) && stateObject.object.owner.ObjectOwner === stateFieldId, 'SALE_ORIGINAL_SOURCE_MODULE_BINDING')
    soulBinding = { soulId: soul.id, stateFieldId, soulVersion: String(soulObject.reference.version), soulDigest: soulObject.reference.digest,
      rootRevision: soul.revision, manifestHex }
  }
  let nativeCollectionBinding: { collectionId: string; fieldId: string; writerTransactionDigest: string; trail: Array<{ version: string; transactionDigest: string; checkpoint: string }> } | null = null
  if (offer.collection !== null) {
    const keyType = type(native.origins, 'birth', 'CollectionKey'), fieldId = deriveDynamicFieldID(state.id, keyType, moveEmptyStructBytes())
    commerceCheck(!effects.V2.changedObjects.some(([id]) => id === fieldId), 'SALE_ORIGINAL_SOURCE_COLLECTION_CHANGED')
    const child = await readHistoricalChildThroughOwnedParent({ client, anchorEffects: effects, anchorTransactionDigest: packet.digest,
      anchorCheckpoint: checkpoint, anchorMode: 'input', rootId: state.id, rootType: type(native.origins, 'birth', 'State'),
      rootOwnerId: stateObject.object.owner.ObjectOwner!, childId: fieldId, childType: `0x2::dynamic_field::Field<${keyType},0x2::object::ID>`,
      chainIdentifier: '35834a8a', genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', signal,
      assertRoot: bytes => { const old = decodeCommerce(CanonicalNativeStateBcs, bytes)
        commerceCheck(old.id === state.id && old.root === plan.soulId && old.protocol === plan.configId && old.registry === plan.registryId && old.schema === 1,
          'SALE_ORIGINAL_SOURCE_COLLECTION_ANCESTOR') } })
    const field = decodeCommerce(CollectionField, child.bytes)
    commerceCheck(field.id === fieldId && field.name.dummy_field === false && field.value === offer.collection, 'SALE_ORIGINAL_SOURCE_COLLECTION_BINDING')
    nativeCollectionBinding = { collectionId: field.value, fieldId, writerTransactionDigest: child.writerTransactionDigest, trail: child.trail }
  }
  const registryType = type(native.origins, 'registry', 'Registry'), registryObject = await read(plan.registryId, registryType, 'readonly')
  const registry = decodeCommerce(NativeSaleRegistryBcs, registryObject.bytes), shared = plan.shared.find(row => row.objectId === plan.registryId)
  commerceCheck(shared && !shared.mutable && registryObject.object.owner.Shared?.initialSharedVersion === shared.initialSharedVersion
    && registry.id === plan.registryId && registry.protocol === plan.configId && registry.schema === 1, 'SALE_ORIGINAL_SOURCE_REGISTRY')
  const configType = `${type(foundation.origins, 'economics', 'Config')}<${plan.coinType}>`, configObject = await read(plan.configId, configType, 'input')
  const config = decodeCommerce(EconomicsConfigBcs, configObject.bytes), gates = recoverEconomicsHistoricalGates(config)
  const configRef = plan.shared.find(row => row.objectId === plan.configId)
  commerceCheck(configRef?.mutable && configObject.object.owner.Shared?.initialSharedVersion === configRef.initialSharedVersion
    && config.id === plan.configId && config.schema === 3 && config.original_package === foundation.pin.originalPackageId
    && config.callable_package === foundation.pin.callablePackageId && normalizeStructTag(config.payment_coin.name) === plan.coinType,
    'SALE_ORIGINAL_SOURCE_CONFIG')
  const key = `${type(foundation.origins, 'economics', 'SourceRegistryKey')}<${registryType}>`, directoryId = deriveDynamicFieldID(plan.configId, key, moveEmptyStructBytes())
  commerceCheck(!effects.V2.changedObjects.some(([id]) => id === directoryId), 'SALE_ORIGINAL_SOURCE_DIRECTORY_CHANGED')
  const directory = await readHistoricalChildThroughParent({ client, anchorEffects: effects, anchorTransactionDigest: packet.digest,
    anchorCheckpoint: checkpoint, anchorMode: 'input', rootId: plan.configId, rootType: configType, parentUid: plan.configId,
    childId: directoryId, childType: `0x2::dynamic_field::Field<${key},${type(foundation.origins, 'economics', 'SourceRegistryLocation')}>`,
    chainIdentifier: '35834a8a', genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', signal,
    assertContainsParent: bytes => commerceCheck(decodeCommerce(EconomicsConfigBcs, bytes).id === plan.configId, 'SALE_ORIGINAL_SOURCE_ANCESTOR') })
  const field = decodeCommerce(NativeSaleSourceLocationBcs, directory.bytes)
  commerceCheck(field.id === directoryId && field.name.dummy_field === false && field.value.id === registry.id, 'SALE_ORIGINAL_SOURCE_DIRECTORY')
  return { proof: 'original-native-state-registry-config-directory-only' as const, transactionDigest: packet.digest,
    soulId: plan.soulId, stateId: state.id, registryId: registry.id, directoryId, gates: gates.gates,
    directoryHistory: { writerTransactionDigest: directory.writerTransactionDigest, trail: directory.trail },
    soulBinding, nativeCollectionBinding, requiresOriginalSoulModuleBinding: soulBinding === null,
    requiresOriginalNativeCollectionAbsenceProof: offer.collection === null,
    requiresOriginalCollectionMembershipProof: offer.collection !== null,
    notCompleteSaleProof: true as const, notCurrentAuthority: true as const }
}
