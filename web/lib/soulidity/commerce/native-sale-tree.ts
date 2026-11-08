import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromHex, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { receiveManagementSoul } from '../management/receive'
import { CanonicalSoulBcs, CanonicalNativeStateBcs, type CanonicalNativeWorkbenchTarget } from '../canonical-native-workbench'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { commerceCheck, decodeCommerce, readCommerceObject } from './economics-read'

const Key = bcs.struct('Key', { namespace: bcs.struct('TypeName', { name: bcs.string() }), name: bcs.byteVector() })
const AnnotationField = bcs.struct('Field', { id: bcs.Address, name: Key, value: bcs.byteVector() })
const VersionField = bcs.struct('Field', { id: bcs.Address, name: Key, value: bcs.struct('ModuleVersion', { installed: bcs.u64(), updated: bcs.u64() }) })
const TopologyField = bcs.struct('Field', { id: bcs.Address, name: MoveEmptyStructBcs, value: bcs.u64() })
const CollectionField = bcs.struct('Field', { id: bcs.Address, name: MoveEmptyStructBcs, value: bcs.Address })
const DUTY = new TextEncoder().encode('soulidity.lifecycle/handover:v1')

/** Standard Manifest has a domain prefix and exactly the Soul fields except
 * the final editing flag. Both layouts are from the current Standard source;
 * canonical Soul parsing prevents slicing arbitrary/trailing bytes.
 */
export function nativeSaleSoulManifest(bytes: Uint8Array) {
  const root = decodeCommerce(CanonicalSoulBcs, bytes)
  commerceCheck(!root.editing, 'SALE_TREE_EDITING')
  const domain = bcs.byteVector().serialize(new TextEncoder().encode('soulidity/standard/manifest/v1')).toBytes()
  return sha3_256(new Uint8Array([...domain, ...bytes.subarray(0, bytes.length - 1)]))
}

/** Current public Native market's recursive sale range and lifecycle duties.
 * Authenticates all module bodies via the Standard reception consumer, child
 * topology/manifest, source State and current annotations/version records.
 * Nonzero nested royalties/Collection bindings and unacknowledgeable source
 * duties are rejected, never silently dropped. No signing/current-access grant.
 */
export async function readNativeSaleTree(input: { client: SuiGrpcClient; target: CanonicalNativeWorkbenchTarget;
  soulId: string; expectedRevision: string; expectedManifest: Uint8Array; signal: AbortSignal }) {
  const target = structuredClone(input.target), client = input.client, soulId = input.soulId
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  const standard = await readPinnedMovePackage(client, target.standard, signal), native = await readPinnedMovePackage(client, target.native, signal)
  const dependency = native.linkage.get(target.standard.originalPackageId)
  commerceCheck(dependency?.upgradedId === target.standard.callablePackageId && dependency.upgradedVersion === String(standard.version), 'SALE_TREE_LINKAGE')
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'SALE_TREE_ORIGIN'); return `${origin}::${module}::${name}` }
  const rootType = type(standard.origins, 'soul', 'Soul'), nestedType = type(standard.origins, 'soul', 'NestedSoulWitness')
  const nativeType = type(native.origins, 'birth', 'NativeModule'), stateType = type(native.origins, 'birth', 'State')
  const observations = new Map<string, { type: string; version: string; digest: string }>()
  async function read(id: string, expectedType: string) {
    const row = await readCommerceObject(client, id, expectedType, signal), old = observations.get(id)
    commerceCheck(!old || old.type === expectedType && old.version === row.version && old.digest === row.digest, 'SALE_TREE_CHANGED')
    observations.set(id, { type: expectedType, version: row.version, digest: row.digest }); return row
  }
  async function optional(id: string, expectedType: string) {
    try { return await read(id, expectedType) } catch (error) { signal.throwIfAborted()
      if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return null
      throw error }
  }
  const nodes: Array<{ soulId: string; parentId: string | null; revision: string; nativeStateId: string | null;
    modules: Array<{ namespace: string; nameHex: string; valueType: string; objectId: string; schema: number; removable: boolean }>;
    excludedExternalSourceId: string | null }> = [], seen = new Set<string>()
  async function walk(id: string, parentId: string | null, depth: number, bodyHash?: string, semanticHash?: string) {
    commerceCheck(depth <= 16 && nodes.length < 256 && !seen.has(id), 'SALE_TREE_BOUNDS_OR_CYCLE'); seen.add(id)
    const reception = await receiveManagementSoul({ client, target: { chainIdentifier: target.chainIdentifier, standard: target.standard }, soulId: id, signal })
    const object = await read(id, rootType), root = decodeCommerce(CanonicalSoulBcs, object.contents)
    commerceCheck(object.version === reception.rootVersion && object.digest === reception.rootDigest && root.modules.length <= 64, 'SALE_TREE_ROOT_STAMP')
    if (bodyHash) commerceCheck(toHex(sha3_256(object.contents)) === bodyHash && toHex(nativeSaleSoulManifest(object.contents)) === semanticHash, 'SALE_TREE_NESTED_COMMITMENT')
    else commerceCheck(root.revision === input.expectedRevision && toHex(nativeSaleSoulManifest(object.contents)) === toHex(input.expectedManifest), 'SALE_TREE_OFFER_MANIFEST')
    const node = { soulId: id, parentId, revision: root.revision, nativeStateId: null as string | null,
      modules: reception.modules.map(m => ({ namespace: m.namespace, nameHex: m.nameHex, valueType: m.valueType, objectId: m.objectId, schema: m.schema, removable: m.removable })),
      excludedExternalSourceId: null as string | null }; nodes.push(node)
    const topologyType = type(standard.origins, 'soul', 'NestingVersionKey')
    const topologyId = deriveDynamicFieldID(id, topologyType, moveEmptyStructBytes())
    const topologyObject = await read(topologyId, `0x2::dynamic_field::Field<${topologyType},u64>`)
    const topology = decodeCommerce(TopologyField, topologyObject.contents)
    commerceCheck(topology.id === topologyId && topologyObject.owner.ObjectOwner === id && BigInt(topology.value) <= BigInt(root.revision), 'SALE_TREE_TOPOLOGY')
    let hasNative = false
    for (const m of reception.modules) {
      const isNative = m.namespace === nativeType && m.nameHex === '6e6174697665'
      // TypeName's raw string is itself part of this dynamic-field key. A
      // display-normalized 0x prefix must not change the original key bytes.
      const descriptor = root.modules.find(d => normalizeStructTag(d.namespace.name) === m.namespace && toHex(d.name) === m.nameHex)
      commerceCheck(descriptor, 'SALE_TREE_DESCRIPTOR')
      const key = { namespace: descriptor.namespace, name: fromHex(m.nameHex) }
      const annotationType = type(standard.origins, 'soul', 'ModuleAnnotationKey')
      const annotationId = deriveDynamicFieldID(id, annotationType, Key.serialize(key).toBytes())
      const annotationObject = await optional(annotationId, `0x2::dynamic_field::Field<${annotationType},vector<u8>>`)
      const annotation = annotationObject ? decodeCommerce(AnnotationField, annotationObject.contents) : null
      if (annotation) commerceCheck(annotation.id === annotationId && annotationObject!.owner.ObjectOwner === id
        && normalizeStructTag(annotation.name.namespace.name) === m.namespace && toHex(annotation.name.name) === m.nameHex, 'SALE_TREE_ANNOTATION')
      const bytes = annotation?.value
      const required = !!bytes && bytes.length === DUTY.length + 1 && bytes[bytes.length - 1] <= 1 && DUTY.every((v, i) => bytes[i] === v)
      commerceCheck(!required || isNative, 'SALE_TREE_UNSUPPORTED_HANDOVER_DUTY')
      if (isNative) {
        commerceCheck(!hasNative && required && m.valueType === stateType && m.schema === 1, 'SALE_TREE_NATIVE_MODULE'); hasNative = true
        const versionType = type(standard.origins, 'soul', 'ModuleVersionKey'), versionId = deriveDynamicFieldID(id, versionType, Key.serialize(key).toBytes())
        const versionObject = await read(versionId, `0x2::dynamic_field::Field<${versionType},${type(standard.origins, 'soul', 'ModuleVersion')}>`)
        const version = decodeCommerce(VersionField, versionObject.contents)
        commerceCheck(version.id === versionId && versionObject.owner.ObjectOwner === id && version.value.installed !== '0'
          && toHex(Key.serialize(version.name).toBytes()) === toHex(Key.serialize(key).toBytes())
          && BigInt(version.value.updated) >= BigInt(version.value.installed) && BigInt(version.value.updated) <= BigInt(root.revision), 'SALE_TREE_MODULE_VERSION')
        const stateObject = await read(m.objectId, stateType), state = decodeCommerce(CanonicalNativeStateBcs, stateObject.contents)
        commerceCheck(state.id === m.objectId && state.root === id && state.schema === 1 && state.provenance.kind <= 2
          && toHex(sha3_256(stateObject.contents)) === m.bodyHash, 'SALE_TREE_NATIVE_STATE')
        node.nativeStateId = state.id
        if (state.provenance.kind === 2) { commerceCheck(state.provenance.joined, 'SALE_TREE_JOIN_SOURCE'); node.excludedExternalSourceId = state.provenance.joined.object }
        const collectionType = type(native.origins, 'birth', 'CollectionKey'), collectionId = deriveDynamicFieldID(state.id, collectionType, moveEmptyStructBytes())
        const collectionObject = await optional(collectionId, `0x2::dynamic_field::Field<${collectionType},0x2::object::ID>`)
        const collection = collectionObject ? decodeCommerce(CollectionField, collectionObject.contents) : null
        if (collection) commerceCheck(collection.id === collectionId && collectionObject!.owner.ObjectOwner === state.id, 'SALE_TREE_COLLECTION_FIELD')
        if (parentId !== null) commerceCheck(state.creator_royalty_bps === 0 && collection === null, 'SALE_TREE_NESTED_ECONOMIC_RIGHTS')
      }
      if (m.namespace === nestedType) {
        commerceCheck(m.valueType === rootType && m.schema === 1 && m.nameHex === toHex(bcs.Address.serialize(m.objectId).toBytes()), 'SALE_TREE_NESTED_BINDING')
        await walk(m.objectId, id, depth + 1, m.bodyHash, m.semanticHash)
      }
    }
    if (parentId === null) commerceCheck(hasNative, 'SALE_TREE_ROOT_NATIVE_REQUIRED')
  }
  await walk(soulId, null, 0)
  for (const [id, stamp] of observations) await read(id, stamp.type)
  return { proof: 'native-sale-current-supported-tree-and-duties-only' as const, soulId, nodes,
    notAuthorization: true as const, remaining: ['SOURCE_REGISTRY_BINDING', 'FUNDS', 'FINAL_TRANSACTION_GRAPH', 'WALLET_PREFLIGHT', 'POST_SALE_CLEANUP_PROOF'] as const }
}
