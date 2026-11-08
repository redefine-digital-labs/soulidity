import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { NativeInitialAuthorizationBcs } from '../native-initial-children'
import { commerceCheck, decodeCommerce } from './economics-read'
import { readHistoricalChildThroughOwnedParent } from '../../sui/historical-owned-parent'
import { CanonicalSoulBcs, CanonicalNativeStateBcs } from '../canonical-native-workbench'
import { sha3_256 } from '@noble/hashes/sha3.js'

const Field = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address })

/** One original Native authorization transition, NOT recursive tree coverage.
 * Parent must independently establish this State's membership in the original
 * Soul tree and the matching GenerationChanged event. Original DOF wrapper
 * is read from effects or the original State's exact owned ancestry. Never
 * substitutes a current DF lookup for the original wrapper binding.
 */
export async function proveNativeSaleAuthorizationTransition(input: { client: SuiGrpcClient;
  effects: ReturnType<typeof bcs.TransactionEffects.parse>; transactionDigest: string;
  soulId: string; stateId: string; authorizationId: string; expectedGeneration: string;
  native: PinnedMovePackage; content: PinnedMovePackage; signal: AbortSignal;
  historicalAnchor?: { checkpoint: string; chainIdentifier: string; genesisDigest: string; standard: PinnedMovePackage } }) {
  const effects = structuredClone(input.effects), { client, signal, transactionDigest, soulId, stateId, authorizationId } = input
  const nativePin = structuredClone(input.native), contentPin = structuredClone(input.content)
  const historicalAnchor = input.historicalAnchor && structuredClone(input.historicalAnchor)
  const generation = input.expectedGeneration
  commerceCheck(/^(0|[1-9][0-9]{0,19})$/.test(generation) && BigInt(generation) < (1n << 64n) - 1n
    && [soulId, stateId, authorizationId].every(id => /^0x[0-9a-f]{64}$/.test(id) && BigInt(id) !== 0n)
    && new Set([soulId, stateId, authorizationId]).size === 3, 'SALE_AUTH_SUBJECT')
  const e = effects.V2
  commerceCheck(e?.status.$kind === 'Success' && e.transactionDigest === transactionDigest && e.changedObjects.length <= 4096
    && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length, 'SALE_AUTH_CONTEXT')
  const native = await readPinnedMovePackage(client, nativePin, signal), content = await readPinnedMovePackage(client, contentPin, signal)
  const link = native.linkage.get(contentPin.originalPackageId)
  commerceCheck(link?.upgradedId === contentPin.callablePackageId && link.upgradedVersion === String(content.version), 'SALE_AUTH_CONTENT_LINK')
  const keyOrigin = native.origins.get('birth::AuthorizationKey'), operatorOrigin = native.origins.get('birth::ContentOperator')
  const authOrigin = content.origins.get('authorization::Authorization')
  commerceCheck(keyOrigin && operatorOrigin && authOrigin, 'SALE_AUTH_ORIGINS')
  const wrapper = `0x2::dynamic_object_field::Wrapper<${keyOrigin}::birth::AuthorizationKey>`
  const fieldId = deriveDynamicFieldID(stateId, wrapper, moveEmptyStructBytes())
  const fieldChanged = e.changedObjects.some(([id]) => id === fieldId)
  const read = (objectId: string, type: string, mode: 'input' | 'mutated') => readHistoricalMoveObject({ client, effects,
    transactionDigest, objectId, type, mode, signal, maxBytes: 256 * 1024 })
  const fieldType = `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`
  let fieldBytes: Uint8Array
  let fieldHistory: { writerTransactionDigest: string; trail: Array<{ version: string; transactionDigest: string; checkpoint: string }> } | null = null
  if (fieldChanged) {
    const fieldBefore = await read(fieldId, fieldType, 'input'), fieldAfter = await read(fieldId, fieldType, 'mutated')
    commerceCheck(fieldBefore.object.owner.ObjectOwner === stateId && fieldAfter.object.owner.ObjectOwner === stateId
      && toHex(fieldBefore.bytes) === toHex(fieldAfter.bytes), 'SALE_AUTH_DOF_PRESERVED')
    fieldBytes = fieldBefore.bytes
  } else {
    commerceCheck(historicalAnchor && historicalAnchor.chainIdentifier === '35834a8a'
      && historicalAnchor.genesisDigest === '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', 'SALE_AUTH_ORIGINAL_DOF_HISTORY_REQUIRED')
    const standard = await readPinnedMovePackage(client, historicalAnchor.standard, signal)
    const dependency = native.linkage.get(historicalAnchor.standard.originalPackageId)
    commerceCheck(dependency?.upgradedId === historicalAnchor.standard.callablePackageId
      && dependency.upgradedVersion === String(standard.version), 'SALE_AUTH_STANDARD_LINK')
    const rootOrigin = standard.origins.get('soul::Soul'), moduleKeyOrigin = standard.origins.get('soul::ModuleKey')
    const witnessOrigin = native.origins.get('birth::NativeModule'), stateOrigin = native.origins.get('birth::State')
    commerceCheck(rootOrigin && moduleKeyOrigin && witnessOrigin && stateOrigin, 'SALE_AUTH_TREE_ORIGINS')
    const root = decodeCommerce(CanonicalSoulBcs, (await read(soulId, `${rootOrigin}::soul::Soul`, 'input')).bytes)
    const witness = `${witnessOrigin}::birth::NativeModule`, stateType = `${stateOrigin}::birth::State`
    const descriptors = root.modules.filter(d => normalizeStructTag(d.namespace.name) === witness && toHex(d.name) === '6e6174697665')
    commerceCheck(root.id === soulId && root.schema === 1 && !root.editing && root.modules.length <= 64 && descriptors.length === 1, 'SALE_AUTH_ORIGINAL_ROOT')
    const descriptor = descriptors[0]
    commerceCheck(descriptor.object === stateId && normalizeStructTag(descriptor.value_type.name) === stateType
      && descriptor.schema === 1 && !descriptor.removable, 'SALE_AUTH_ORIGINAL_DESCRIPTOR')
    const moduleWrapper = `0x2::dynamic_object_field::Wrapper<${moduleKeyOrigin}::soul::ModuleKey<${witness}>>`
    const moduleFieldId = deriveDynamicFieldID(soulId, moduleWrapper, bcs.byteVector().serialize(new TextEncoder().encode('native')).toBytes())
    const originalState = await read(stateId, stateType, 'input')
    const assertState = (bytes: Uint8Array) => {
      const state = decodeCommerce(CanonicalNativeStateBcs, bytes)
      commerceCheck(state.id === stateId && state.root === soulId && state.schema === 1, 'SALE_AUTH_ORIGINAL_STATE')
    }
    assertState(originalState.bytes)
    commerceCheck(originalState.object.owner.ObjectOwner === moduleFieldId
      && toHex(sha3_256(originalState.bytes)) === toHex(descriptor.body_hash), 'SALE_AUTH_ORIGINAL_STATE_OWNER_OR_BODY')
    const proof = await readHistoricalChildThroughOwnedParent({ client, anchorEffects: effects, anchorTransactionDigest: transactionDigest,
      anchorCheckpoint: historicalAnchor.checkpoint, anchorMode: 'input', rootId: stateId, rootType: stateType,
      rootOwnerId: moduleFieldId, childId: fieldId, childType: fieldType, chainIdentifier: historicalAnchor.chainIdentifier,
      genesisDigest: historicalAnchor.genesisDigest, signal, assertRoot: assertState })
    fieldBytes = proof.bytes; fieldHistory = { writerTransactionDigest: proof.writerTransactionDigest, trail: proof.trail }
  }
  const field = decodeCommerce(Field, fieldBytes)
  commerceCheck(field.id === fieldId && field.name.name.dummy_field === false && field.value === authorizationId, 'SALE_AUTH_DOF_BINDING')
  const type = `${authOrigin}::authorization::Authorization`
  const before = await read(authorizationId, type, 'input'), after = await read(authorizationId, type, 'mutated')
  const a = decodeCommerce(NativeInitialAuthorizationBcs, before.bytes), b = decodeCommerce(NativeInitialAuthorizationBcs, after.bytes)
  commerceCheck(before.object.owner.ObjectOwner === fieldId && after.object.owner.ObjectOwner === fieldId
    && a.id === authorizationId && a.root === soulId && a.controller.root === soulId && a.controller.parent === stateId
    && normalizeStructTag(a.controller.operator.name) === `${operatorOrigin}::birth::ContentOperator`
    && a.generation === generation && BigInt(b.generation) === BigInt(a.generation) + 1n && b.count === '0'
    && BigInt(a.count) <= BigInt(a.capacity) && BigInt(a.count) <= BigInt(a.grants.size) && BigInt(a.capacity) <= 10000n
    && publicMutationCanonical({ ...a, generation: null, count: null }) === publicMutationCanonical({ ...b, generation: null, count: null }), 'SALE_AUTH_TRANSITION')
  commerceCheck(!e.changedObjects.some(([id, row]) => row.inputState.Exist?.[1].ObjectOwner === a.grants.id
    || row.outputState.ObjectWrite?.[1].ObjectOwner === a.grants.id || id === a.grants.id), 'SALE_AUTH_GRANTS_UNEXPECTED_WRITE')
  return { proof: 'native-sale-one-original-authorization-transition-only' as const, transactionDigest,
    soulId, stateId, authorizationId, oldGeneration: a.generation, newGeneration: b.generation,
    retainedPhysicalGrantCount: b.grants.size, fieldHistory, claimedEffectIds: [...(fieldChanged ? [fieldId] : []), authorizationId],
    requiresOriginalTreeMembershipAndEventProof: true as const, notRecursiveCleanupProof: true as const,
    notCompleteSaleProof: true as const, notCurrentAuthority: true as const }
}
