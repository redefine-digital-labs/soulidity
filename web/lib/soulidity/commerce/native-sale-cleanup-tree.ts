import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { deriveKioskItemFieldId } from '@soulidity/sdk'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { CanonicalSoulBcs, CanonicalNativeStateBcs } from '../canonical-native-workbench'
import { NativeInitialAuthorizationBcs } from '../native-initial-children'
import { NativeOfferBcs } from './economics-bcs'
import { commerceCheck, decodeCommerce } from './economics-read'
import { parseNativeSaleGraphPlan, type NativeSaleGraphPlan } from './native-sale-graph'
import { nativeSaleSoulManifest } from './native-sale-tree'
import { proveNativeSaleAuthorizationTransition } from './native-sale-authorization'

const Events = bcs.vector(bcs.struct('Event', { package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
  type_: bcs.StructTag, contents: bcs.byteVector() }))
export const NativeSaleGenerationChangedBcs = bcs.struct('GenerationChanged', { root: bcs.Address, old: bcs.u64(), new: bcs.u64() })
const VersionKey = bcs.struct('Key', { namespace: bcs.struct('TypeName', { name: bcs.string() }), name: bcs.byteVector() })
const VersionField = bcs.struct('Field', { id: bcs.Address, name: VersionKey,
  value: bcs.struct('ModuleVersion', { installed: bcs.u64(), updated: bcs.u64() }) })

/** Original recursive topology + State/auth generation/event coverage only.
 * Parent authenticates exact graph/finality/checkpoint. Does not prove every
 * original module annotation/semantic support/Collection duty or qualify the
 * executed implementation. It cannot independently complete a sale receipt.
 */
export async function proveNativeSaleCleanupTree(input: { client: SuiGrpcClient; plan: NativeSaleGraphPlan;
  effects: ReturnType<typeof bcs.TransactionEffects.parse>; events: Uint8Array; transactionDigest: string; checkpoint: string;
  native: PinnedMovePackage; standard: PinnedMovePackage; content: PinnedMovePackage; signal: AbortSignal }) {
  const plan = parseNativeSaleGraphPlan(input.plan), effects = structuredClone(input.effects), eventBytes = new Uint8Array(input.events)
  const nativePin = structuredClone(input.native), standardPin = structuredClone(input.standard), contentPin = structuredClone(input.content)
  const { client, signal, transactionDigest, checkpoint } = input, e = effects.V2
  commerceCheck(e?.status.$kind === 'Success' && e.transactionDigest === transactionDigest && e.changedObjects.length <= 4096
    && new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length && eventBytes.length <= 1024 * 1024, 'SALE_CLEANUP_CONTEXT')
  const native = await readPinnedMovePackage(client, nativePin, signal), standard = await readPinnedMovePackage(client, standardPin, signal)
  const content = await readPinnedMovePackage(client, contentPin, signal)
  commerceCheck(nativePin.callablePackageId === plan.callablePackageId, 'SALE_CLEANUP_CALLABLE')
  for (const pkg of [standard, content]) { const link = native.linkage.get(pkg.pin.originalPackageId)
    commerceCheck(link?.upgradedId === pkg.pin.callablePackageId && link.upgradedVersion === String(pkg.version), 'SALE_CLEANUP_LINK') }
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'SALE_CLEANUP_ORIGIN'); return `${origin}::${module}::${name}` }
  const soulType = type(standard.origins, 'soul', 'Soul'), nestedWitness = type(standard.origins, 'soul', 'NestedSoulWitness')
  const moduleKey = type(standard.origins, 'soul', 'ModuleKey'), nativeWitness = type(native.origins, 'birth', 'NativeModule')
  const versionKey = type(standard.origins, 'soul', 'ModuleVersionKey'), versionType = type(standard.origins, 'soul', 'ModuleVersion')
  const stateType = type(native.origins, 'birth', 'State'), authType = type(content.origins, 'authorization', 'Authorization')
  const authKey = type(native.origins, 'birth', 'AuthorizationKey')
  const read = (objectId: string, expectedType: string, mode: 'input' | 'mutated') => readHistoricalMoveObject({ client, effects,
    transactionDigest, objectId, type: expectedType, mode, signal, maxBytes: 256 * 1024 })
  const offer = decodeCommerce(NativeOfferBcs, (await read(plan.offerId, type(native.origins, 'market', 'Offer'), 'input')).bytes)
  commerceCheck(offer.id === plan.offerId && offer.root === plan.soulId && offer.kiosk === plan.sellerKioskId
    && offer.registry === plan.registryId && offer.config === plan.configId && offer.generation === plan.generation
    && offer.active && offer.purchase, 'SALE_CLEANUP_OFFER')
  const nodes: Array<{ soulId: string; stateId: string | null; nativeVersion: { fieldId: string; installed: string; beforeUpdated: string; afterUpdated: string } | null;
    authorization: Awaited<ReturnType<typeof proveNativeSaleAuthorizationTransition>> | null }> = []
  const seen = new Set<string>()
  async function walk(id: string, ownerBefore: string, ownerAfter: string, depth: number,
    commitments?: { beforeBody: string; beforeManifest: string; afterBody: string; afterManifest: string }) {
    commerceCheck(depth <= 16 && nodes.length < 256 && !seen.has(id), 'SALE_CLEANUP_TREE_BOUND'); seen.add(id)
    const before = await read(id, soulType, 'input'), after = await read(id, soulType, 'mutated')
    const a = decodeCommerce(CanonicalSoulBcs, before.bytes), b = decodeCommerce(CanonicalSoulBcs, after.bytes)
    commerceCheck(before.object.owner.ObjectOwner === ownerBefore && after.object.owner.ObjectOwner === ownerAfter
      && a.id === id && b.id === id && a.schema === 1 && b.schema === 1 && !a.editing && !b.editing
      && a.modules.length <= 64 && BigInt(b.revision) >= BigInt(a.revision)
      && publicMutationCanonical({ ...a, modules: null, revision: null }) === publicMutationCanonical({ ...b, modules: null, revision: null })
      && a.modules.length === b.modules.length, 'SALE_CLEANUP_SOUL_TRANSITION')
    if (commitments) commerceCheck(toHex(sha3_256(before.bytes)) === commitments.beforeBody && toHex(nativeSaleSoulManifest(before.bytes)) === commitments.beforeManifest
      && toHex(sha3_256(after.bytes)) === commitments.afterBody && toHex(nativeSaleSoulManifest(after.bytes)) === commitments.afterManifest, 'SALE_CLEANUP_NESTED_COMMITMENT')
    else commerceCheck(a.revision === offer.root_revision && toHex(nativeSaleSoulManifest(before.bytes)) === toHex(offer.manifest), 'SALE_CLEANUP_OFFER_MANIFEST')
    const node = { soulId: id, stateId: null as string | null,
      nativeVersion: null as { fieldId: string; installed: string; beforeUpdated: string; afterUpdated: string } | null,
      authorization: null as Awaited<ReturnType<typeof proveNativeSaleAuthorizationTransition>> | null }; nodes.push(node)
    for (const [index, d] of a.modules.entries()) {
      const next = b.modules[index]
      commerceCheck(publicMutationCanonical({ ...d, body_hash: null, semantic_hash: null }) === publicMutationCanonical({ ...next, body_hash: null, semantic_hash: null }), 'SALE_CLEANUP_MODULE_IDENTITY')
      const namespace = normalizeStructTag(d.namespace.name)
      if (namespace === nativeWitness && toHex(d.name) === '6e6174697665') {
        commerceCheck(!node.stateId && normalizeStructTag(d.value_type.name) === stateType && d.schema === 1 && !d.removable, 'SALE_CLEANUP_NATIVE_DESCRIPTOR')
        node.stateId = d.object
        // Raw TypeName string bytes belong to the original field key. Display
        // normalization must not change the DF address or key encoding.
        const versionName = { namespace: d.namespace, name: d.name }, versionId = deriveDynamicFieldID(id, versionKey, VersionKey.serialize(versionName).toBytes())
        const fieldType = `0x2::dynamic_field::Field<${versionKey},${versionType}>`
        const versionBefore = await read(versionId, fieldType, 'input'), versionAfter = await read(versionId, fieldType, 'mutated')
        const va = decodeCommerce(VersionField, versionBefore.bytes), vb = decodeCommerce(VersionField, versionAfter.bytes)
        commerceCheck(versionBefore.object.owner.ObjectOwner === id && versionAfter.object.owner.ObjectOwner === id && va.id === versionId && vb.id === versionId
          && toHex(VersionKey.serialize(va.name).toBytes()) === toHex(VersionKey.serialize(versionName).toBytes())
          && toHex(VersionKey.serialize(vb.name).toBytes()) === toHex(VersionKey.serialize(versionName).toBytes())
          && BigInt(va.value.installed) > 0n && va.value.installed === vb.value.installed
          && BigInt(va.value.installed) <= BigInt(va.value.updated) && BigInt(va.value.updated) <= BigInt(a.revision)
          && BigInt(vb.value.updated) > BigInt(a.revision) && BigInt(vb.value.updated) <= BigInt(b.revision), 'SALE_CLEANUP_NATIVE_VERSION')
        node.nativeVersion = { fieldId: versionId, installed: va.value.installed, beforeUpdated: va.value.updated, afterUpdated: vb.value.updated }
        const oldState = await read(d.object, stateType, 'input'), newState = await read(d.object, stateType, 'mutated')
        const state = decodeCommerce(CanonicalNativeStateBcs, oldState.bytes)
        const stateField = deriveDynamicFieldID(id, `0x2::dynamic_object_field::Wrapper<${moduleKey}<${nativeWitness}>>`, bcs.byteVector().serialize(d.name).toBytes())
        commerceCheck(state.id === d.object && state.root === id && state.schema === 1 && state.provenance.kind <= 2
          && oldState.object.owner.ObjectOwner === stateField && newState.object.owner.ObjectOwner === stateField
          && toHex(oldState.bytes) === toHex(newState.bytes) && toHex(sha3_256(oldState.bytes)) === toHex(d.body_hash)
          && toHex(d.body_hash) === toHex(next.body_hash) && BigInt(b.revision) > BigInt(a.revision), 'SALE_CLEANUP_NATIVE_STATE')
        if (depth === 0) commerceCheck(state.id === offer.state && state.protocol === offer.config && state.registry === offer.registry
          && state.creator === offer.creator && state.creator_royalty_bps === offer.royalty, 'SALE_CLEANUP_ROOT_STATE')
        const authField = deriveDynamicFieldID(d.object, `0x2::dynamic_object_field::Wrapper<${authKey}>`, moveEmptyStructBytes())
        const candidates = e!.changedObjects.filter(([, row]) => row.inputState.Exist?.[1].ObjectOwner === authField)
        commerceCheck(candidates.length === 1, 'SALE_CLEANUP_AUTH_IDENTITY')
        const authId = candidates[0][0], auth = decodeCommerce(NativeInitialAuthorizationBcs, (await read(authId, authType, 'input')).bytes)
        commerceCheck(depth !== 0 || auth.generation === plan.generation, 'SALE_CLEANUP_ROOT_GENERATION')
        node.authorization = await proveNativeSaleAuthorizationTransition({ client, effects, transactionDigest, soulId: id, stateId: d.object,
          authorizationId: authId, expectedGeneration: auth.generation, native: nativePin, content: contentPin, signal,
          historicalAnchor: { checkpoint, chainIdentifier: '35834a8a', genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', standard: standardPin } })
      } else if (namespace === nestedWitness) {
        commerceCheck(normalizeStructTag(d.value_type.name) === soulType && d.schema === 1 && toHex(d.name) === toHex(bcs.Address.serialize(d.object).toBytes()), 'SALE_CLEANUP_NESTED_DESCRIPTOR')
        const owner = deriveDynamicFieldID(id, `0x2::dynamic_object_field::Wrapper<${moduleKey}<${nestedWitness}>>`, bcs.byteVector().serialize(d.name).toBytes())
        await walk(d.object, owner, owner, depth + 1, { beforeBody: toHex(d.body_hash), beforeManifest: toHex(d.semantic_hash), afterBody: toHex(next.body_hash), afterManifest: toHex(next.semantic_hash) })
      } else commerceCheck(toHex(d.body_hash) === toHex(next.body_hash) && toHex(d.semantic_hash) === toHex(next.semantic_hash), 'SALE_CLEANUP_FOREIGN_MODULE_CHANGED')
    }
    if (depth === 0) commerceCheck(node.stateId, 'SALE_CLEANUP_ROOT_NATIVE_REQUIRED')
  }
  await walk(plan.soulId, deriveKioskItemFieldId(plan.sellerKioskId, plan.soulId), deriveKioskItemFieldId(plan.buyerKioskId, plan.soulId), 0)
  const events = decodeCommerce(Events, eventBytes), generationType = type(content.origins, 'authorization', 'GenerationChanged')
  commerceCheck(events.length <= 16384, 'SALE_CLEANUP_EVENTS_BOUND')
  const generations = events.filter(event => `${event.type_.address}::${event.type_.module}::${event.type_.name}` === generationType)
  const transitions = nodes.flatMap(node => node.authorization ? [node.authorization] : [])
  commerceCheck(generations.length === transitions.length, 'SALE_CLEANUP_GENERATION_EVENT_COUNT')
  const expected = new Map(transitions.map(t => [t.soulId, t]))
  for (const event of generations) {
    commerceCheck(event.package_id === contentPin.callablePackageId && event.transaction_module === 'authorization'
      && event.sender === plan.buyer && event.type_.typeParams.length === 0, 'SALE_CLEANUP_GENERATION_EVENT_AUTHORITY')
    const row = decodeCommerce(NativeSaleGenerationChangedBcs, event.contents), transition = expected.get(row.root)
    commerceCheck(transition && row.old === transition.oldGeneration && row.new === transition.newGeneration, 'SALE_CLEANUP_GENERATION_EVENT_BINDING')
    expected.delete(row.root)
  }
  commerceCheck(expected.size === 0, 'SALE_CLEANUP_GENERATION_EVENT_MISSING')
  const claimedEffectIds = nodes.flatMap(node => [node.soulId, ...(node.stateId ? [node.stateId] : []),
    ...(node.nativeVersion ? [node.nativeVersion.fieldId] : []), ...(node.authorization?.claimedEffectIds ?? [])])
  commerceCheck(new Set(claimedEffectIds).size === claimedEffectIds.length, 'SALE_CLEANUP_EFFECT_ALIASES')
  return { proof: 'native-sale-original-topology-authorization-and-generation-events-only' as const, transactionDigest, nodes,
    claimedEffectIds,
    requiresOriginalSupportedRightsAndSourceQualification: true as const, notCompleteEffectsReconciliation: true as const,
    notCompleteSaleProof: true as const, notCurrentAuthority: true as const }
}
