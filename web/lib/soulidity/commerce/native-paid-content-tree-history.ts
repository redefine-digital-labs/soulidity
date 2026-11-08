import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { deriveKioskItemFieldId, assertKioskItemField, KIOSK_ITEM_FIELD_TYPE, SoulPublicKioskBcs } from '@soulidity/sdk'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readHistoricalChildThroughParent } from '../../sui/historical-parent-lineage'
import { readHistoricalChildThroughOwnedParent } from '../../sui/historical-owned-parent'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { moveEmptyStructBytes, MoveEmptyStructBcs } from '../../sui/move-empty-struct'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { CanonicalSoulBcs, CanonicalNativeStateBcs } from '../canonical-native-workbench'
import { NativePaidServiceBcs } from './native-paid-service-read'
import { proveNativePaidContentServiceHistory } from './native-paid-content-service-history'
import { commerceCheck, decodeCommerce } from './economics-read'

export const NativePaidKioskLockBcs = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Lock', { id: bcs.Address }), value: bcs.bool() })
export const NativePaidVersionKeyBcs = bcs.struct('ModuleVersionKey', { namespace: bcs.struct('TypeName', { name: bcs.string() }), name: bcs.byteVector() })
export const NativePaidVersionFieldBcs = bcs.struct('Field', { id: bcs.Address, name: NativePaidVersionKeyBcs, value: bcs.struct('ModuleVersion', { installed: bcs.u64(), updated: bcs.u64() }) })
export const NativePaidPointerFieldBcs = bcs.struct('Field', { id: bcs.Address,
  name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address })

/** Original Soul/State body topology and actual PaidKey pointer. Module
 * pointer/annotations, full semantic commitment and source qualification remain
 * explicit obligations. This proof never authorizes a current protected read.
 */
export async function proveNativePaidContentTreeHistory(input: Parameters<typeof proveNativePaidContentServiceHistory>[0] & { checkpoint: string }) {
  const saved = structuredClone({ intent: input.intent, packet: input.packet, gas: input.gas, effects: input.effects, offer: input.offer,
    soulId: input.soulId, stateId: input.stateId, ledgerId: input.ledgerId, native: input.native, content: input.content, foundation: input.foundation,
    standard: input.standard, custody: input.custody, checkpoint: input.checkpoint })
  const { client, signal } = input, p = saved.intent
  await proveNativePaidContentServiceHistory({ ...saved, client, signal })
  const native = await readPinnedMovePackage(client, saved.native, signal), standard = await readPinnedMovePackage(client, saved.standard, signal)
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'PAID_TREE_HISTORY_ORIGIN'); return `${origin}::${module}::${name}` }
  const read = (id: string, type: string, mode: 'input' | 'mutated' | 'created') => readHistoricalMoveObject({ client, effects: saved.effects,
    transactionDigest: saved.packet.digest, objectId: id, type, mode, signal })
  const soulType = type(standard.origins, 'soul', 'Soul'), stateType = type(native.origins, 'birth', 'State'), witness = type(native.origins, 'birth', 'NativeModule')
  const rootBefore = await read(saved.soulId, soulType, 'input'), rootAfter = await read(saved.soulId, soulType, 'mutated')
  const a = decodeCommerce(CanonicalSoulBcs, rootBefore.bytes), z = decodeCommerce(CanonicalSoulBcs, rootAfter.bytes)
  const stateBefore = await read(saved.stateId, stateType, 'input'), stateAfter = await read(saved.stateId, stateType, 'mutated'), state = decodeCommerce(CanonicalNativeStateBcs, stateBefore.bytes)
  const itemId = deriveKioskItemFieldId(p.kiosk.objectId, saved.soulId)
  commerceCheck(rootBefore.object.owner.ObjectOwner === itemId && rootAfter.object.owner.ObjectOwner === itemId
    && a.id === saved.soulId && a.schema === 1 && !a.editing && !z.editing && a.revision === p.rootRevision
    && a.modules.length <= 64 && a.modules.length === z.modules.length && z.revision === String(BigInt(a.revision) + 1n)
    && publicMutationCanonical({ ...a, modules: null, revision: null }) === publicMutationCanonical({ ...z, modules: null, revision: null }), 'PAID_TREE_HISTORY_SOUL')
  commerceCheck(state.id === saved.stateId && state.root === saved.soulId && state.protocol === p.config.objectId && state.registry === p.registry.objectId
    && state.schema === 1 && state.creator === a.origin.minted_by && state.provenance.kind <= 2
    && a.origin.source === p.registry.objectId && a.origin.source_hash.length === 32 && BigInt(a.origin.source_version) > 0n
    && normalizeStructTag(a.origin.source_type.name) === type(native.origins, 'registry', 'Registry')
    && normalizeStructTag(a.origin.producer.name) === type(native.origins, 'registry', 'SoulProducer'), 'PAID_TREE_HISTORY_STATE')
  const descriptors = a.modules.map((d, i) => ({ d, i })).filter(({ d }) => normalizeStructTag(d.namespace.name) === witness && toHex(d.name) === '6e6174697665')
  commerceCheck(descriptors.length === 1, 'PAID_TREE_HISTORY_DESCRIPTOR_COUNT')
  const { d, i } = descriptors[0], next = z.modules[i]
  const moduleFieldId = deriveDynamicFieldID(saved.soulId, `0x2::dynamic_object_field::Wrapper<${type(standard.origins, 'soul', 'ModuleKey')}<${witness}>>`, bcs.byteVector().serialize(d.name).toBytes())
  commerceCheck(d.object === saved.stateId && d.schema === 1 && !d.removable && normalizeStructTag(d.value_type.name) === stateType
    && d.semantic_hash.length === 32 && next.semantic_hash.length === 32 && toHex(d.body_hash) === toHex(sha3_256(stateBefore.bytes))
    && stateBefore.object.owner.ObjectOwner === moduleFieldId && stateAfter.object.owner.ObjectOwner === moduleFieldId
    && toHex(stateBefore.bytes) === toHex(stateAfter.bytes)
    && publicMutationCanonical({ ...d, semantic_hash: null }) === publicMutationCanonical({ ...next, semantic_hash: null })
    && a.modules.every((other, j) => j === i || publicMutationCanonical(other) === publicMutationCanonical(z.modules[j])), 'PAID_TREE_HISTORY_BODY')
  const versionKey = { namespace: d.namespace, name: d.name }, versionId = deriveDynamicFieldID(saved.soulId, type(standard.origins, 'soul', 'ModuleVersionKey'), NativePaidVersionKeyBcs.serialize(versionKey).toBytes())
  const versionType = `0x2::dynamic_field::Field<${type(standard.origins, 'soul', 'ModuleVersionKey')},${type(standard.origins, 'soul', 'ModuleVersion')}>`
  const createdVersion = saved.effects.V2!.changedObjects.find(([id]) => id === versionId)?.[1].idOperation.$kind === 'Created'
  const versionOutput = await read(versionId, versionType, createdVersion ? 'created' : 'mutated'), version = decodeCommerce(NativePaidVersionFieldBcs, versionOutput.bytes)
  let previousVersion: ReturnType<typeof NativePaidVersionFieldBcs.parse> | null = null
  if (!createdVersion) {
    const previousObject = await read(versionId, versionType, 'input'); previousVersion = decodeCommerce(NativePaidVersionFieldBcs, previousObject.bytes)
    commerceCheck(previousObject.object.owner.ObjectOwner === saved.soulId && previousVersion.id === versionId
      && publicMutationCanonical(previousVersion.name) === publicMutationCanonical(versionKey)
      && BigInt(previousVersion.value.installed) <= BigInt(previousVersion.value.updated) && BigInt(previousVersion.value.updated) <= BigInt(a.revision), 'PAID_TREE_HISTORY_VERSION_INPUT')
  }
  commerceCheck(versionOutput.object.owner.ObjectOwner === saved.soulId && version.id === versionId
    && publicMutationCanonical(version.name) === publicMutationCanonical(versionKey)
    && version.value.installed === (previousVersion?.value.installed ?? '0') && version.value.updated === z.revision, 'PAID_TREE_HISTORY_VERSION_TRANSITION')
  const nativeVersion = { fieldId: versionId, installed: version.value.installed, beforeUpdated: previousVersion?.value.updated ?? null, afterUpdated: version.value.updated,
    requiresExactInstallationHistoryProof: version.value.installed === '0' }
  const serviceType = `${type(standard.origins, 'soul', 'SourceService')}<${witness},${stateType}>`, service = decodeCommerce(NativePaidServiceBcs, (await read(p.service.objectId, serviceType, 'input')).bytes)
  commerceCheck(publicMutationCanonical(service.origin) === publicMutationCanonical(a.origin), 'PAID_TREE_HISTORY_SERVICE_ORIGIN')
  const wrapped = `0x2::dynamic_object_field::Wrapper<${type(native.origins, 'birth', 'PaidKey')}>`, fieldId = deriveDynamicFieldID(saved.stateId, wrapped, moveEmptyStructBytes())
  commerceCheck(!saved.effects.V2!.changedObjects.some(([id]) => id === fieldId), 'PAID_TREE_HISTORY_POINTER_CHANGED')
  const pointer = await readHistoricalChildThroughOwnedParent({ client, anchorEffects: saved.effects, anchorTransactionDigest: saved.packet.digest,
    anchorCheckpoint: saved.checkpoint, anchorMode: 'input', rootId: saved.stateId, rootType: stateType, rootOwnerId: moduleFieldId,
    childId: fieldId, childType: `0x2::dynamic_field::Field<${wrapped},0x2::object::ID>`, chainIdentifier: '35834a8a',
    genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', signal, assertRoot: bytes => { const old = decodeCommerce(CanonicalNativeStateBcs, bytes)
      commerceCheck(old.id === saved.stateId && old.root === saved.soulId && old.protocol === p.config.objectId && old.registry === p.registry.objectId && old.schema === 1, 'PAID_TREE_HISTORY_STATE_ANCESTOR')
    } })
  const field = decodeCommerce(NativePaidPointerFieldBcs, pointer.bytes)
  commerceCheck(field.id === fieldId && field.name.name.dummy_field === false && field.value === saved.ledgerId, 'PAID_TREE_HISTORY_LEDGER_POINTER')
  const lockId = deriveDynamicFieldID(p.kiosk.objectId, '0x2::kiosk::Lock', bcs.Address.serialize(saved.soulId).toBytes())
  commerceCheck(!saved.effects.V2!.changedObjects.some(([id]) => id === itemId || id === lockId), 'PAID_TREE_HISTORY_KIOSK_CHILD_CHANGED')
  const kioskChild = (childId: string, childType: string) => readHistoricalChildThroughParent({ client, anchorEffects: saved.effects, anchorTransactionDigest: saved.packet.digest,
    anchorMode: 'input', anchorCheckpoint: saved.checkpoint, rootId: p.kiosk.objectId, rootType: '0x2::kiosk::Kiosk', parentUid: p.kiosk.objectId,
    childId, childType, chainIdentifier: '35834a8a', genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', signal,
    assertContainsParent: (bytes, uid) => { commerceCheck(decodeCommerce(SoulPublicKioskBcs, bytes).id === uid, 'PAID_TREE_HISTORY_KIOSK_ANCESTOR') } })
  const item = await kioskChild(itemId, KIOSK_ITEM_FIELD_TYPE), lock = await kioskChild(lockId, '0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>')
  commerceCheck(assertKioskItemField(item.bytes, p.kiosk.objectId, saved.soulId) === itemId, 'PAID_TREE_HISTORY_KIOSK_ITEM')
  const lockValue = decodeCommerce(NativePaidKioskLockBcs, lock.bytes)
  commerceCheck(lockValue.id === lockId && lockValue.name.id === saved.soulId && lockValue.value, 'PAID_TREE_HISTORY_KIOSK_LOCK')
  const kioskCustody = { proof: 'original-paid-kiosk-item-and-lock-history-only' as const, kioskId: p.kiosk.objectId, soulId: saved.soulId, itemFieldId: itemId, lockFieldId: lockId,
    itemWriterTransactionDigest: item.writerTransactionDigest, lockWriterTransactionDigest: lock.writerTransactionDigest, itemTrail: item.trail, lockTrail: lock.trail, requiresOriginalNoListingProof: true as const, notCurrentCustody: true as const }
  return { proof: 'native-paid-original-soul-state-body-ledger-pointer-only' as const, transactionDigest: saved.packet.digest,
    soulId: saved.soulId, stateId: saved.stateId, ledgerId: saved.ledgerId, moduleFieldId, paidFieldId: fieldId,
    kioskCustody, nativeVersion, claimedEffectIds: [saved.soulId, saved.stateId, versionId], pointerWriterTransactionDigest: pointer.writerTransactionDigest, pointerTrail: pointer.trail,
    requiresOriginalModulePointerAndAnnotationProof: true as const, requiresOriginalSemanticCommitmentProof: true as const,
    requiresQualifiedParentCommitInvariant: true as const, requiresOriginalSourceQualification: true as const,
    notContentDeliveryProof: true as const, notCurrentAuthority: true as const }
}
