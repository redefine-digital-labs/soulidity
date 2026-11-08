import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { profileReadStep } from '@soulidity/sdk'
import { collectionCommandRaw } from '../../collections/collection-command-plan'
import { historicalMoveObjectType } from '../../sui/historical-object'
import { readPinnedMovePackageOrigins, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { CanonicalSoulBcs } from '../canonical-native-workbench'

export interface ManagementStandardTarget { chainIdentifier: string; standard: PinnedMovePackage }
export type ManagementReception = Awaited<ReturnType<typeof receiveManagementSoul>>
const address = (s: string) => /^0x[0-9a-f]{64}$/.test(s) && !/^0x0+$/.test(s)
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`MANAGEMENT_RECEIVE_${code}`) }

/** Producer-neutral reception through the public Standard layout. Every module
 * is resolved by its actual typed dynamic-object field and body hash. Semantic
 * hashes and origin attestations retain their producer meaning; they do not
 * establish a licence, owner authority, or compatibility with another module. */
export async function receiveManagementSoul(input: {
  client: SuiGrpcClient; target: ManagementStandardTarget; soulId: string; signal: AbortSignal
}) {
  const { client, soulId } = input, target = structuredClone(input.target)
  check(target.chainIdentifier === '35834a8a' && address(soulId), 'TARGET')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  const chain = await profileReadStep(signal, () => client.core.getChainIdentifier())
  check(toHex(fromBase58(chain.chainIdentifier).subarray(0, 4)) === target.chainIdentifier, 'CHAIN')
  const origins = await readPinnedMovePackageOrigins(client, target.standard, signal)
  const rootOrigin = origins.get('soul::Soul'), keyOrigin = origins.get('soul::ModuleKey')
  check(rootOrigin && keyOrigin, 'STANDARD_TYPES')
  const seen = new Map<string, { version: string; digest: string }>()
  async function read(objectId: string, type: string) {
    signal.throwIfAborted()
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId,
      readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] } }, { abort: signal }))
    const object = response.object
    check(object?.objectId === objectId && typeof object.version === 'bigint' && object.version > 0n
      && object.digest && object.bcs?.value instanceof Uint8Array && object.bcs.value.length <= 256 * 1024, 'OBJECT')
    const raw = collectionCommandRaw({ objectId, version: String(object.version), digest: object.digest, bcs: toBase64(object.bcs.value) })
    const move = raw.data.Move
    check(move && historicalMoveObjectType(move.type) === normalizeStructTag(type), 'TYPE')
    const stamp = { version: String(object.version), digest: object.digest }, previous = seen.get(objectId)
    check(!previous || previous.version === stamp.version && previous.digest === stamp.digest, 'CHANGED_RETRY')
    seen.set(objectId, stamp)
    return { raw, contents: move.contents, ...stamp }
  }
  const rootType = `${rootOrigin}::soul::Soul`, rootObject = await read(soulId, rootType)
  const root = CanonicalSoulBcs.parse(rootObject.contents)
  check(toBase64(CanonicalSoulBcs.serialize(root).toBytes()) === toBase64(rootObject.contents), 'NONCANONICAL_ROOT')
  check(root.id === soulId && root.schema === 1 && !root.editing
    && root.modules.length <= 64 && root.origin.source_hash.length === 32 && address(root.origin.source)
    && address(root.origin.minted_by) && BigInt(root.origin.source_version) > 0n, 'ROOT')
  const names = new Set<string>(), objects = new Set<string>([soulId])
  const readset: Array<{ id: string; type: string }> = [{ id: soulId, type: rootType }]
  const modules = []
  for (const descriptor of root.modules) {
    const namespace = normalizeStructTag(descriptor.namespace.name), valueType = normalizeStructTag(descriptor.value_type.name)
    const nameHex = toHex(descriptor.name), key = `${namespace}:${nameHex}`
    check(!names.has(key) && descriptor.name.length > 0 && descriptor.name.length <= 64 && descriptor.schema > 0
      && address(descriptor.object) && !objects.has(descriptor.object)
      && descriptor.body_hash.length === 32 && descriptor.semantic_hash.length === 32, 'DESCRIPTOR')
    names.add(key); objects.add(descriptor.object)
    const wrapper = `0x2::dynamic_object_field::Wrapper<${keyOrigin}::soul::ModuleKey<${namespace}>>`
    const fieldId = deriveDynamicFieldID(soulId, wrapper, bcs.byteVector().serialize(descriptor.name).toBytes())
    check(!objects.has(fieldId), 'MODULE_ALIAS'); objects.add(fieldId)
    const fieldType = `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`
    const field = await read(fieldId, fieldType)
    const codec = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', {
      name: bcs.struct('ModuleKey', { name: bcs.byteVector() }) }), value: bcs.Address })
    const link = codec.parse(field.contents)
    check(toBase64(codec.serialize(link).toBytes()) === toBase64(field.contents)
      && link.id === fieldId && field.raw.owner.ObjectOwner === soulId
      && toHex(link.name.name.name) === nameHex && link.value === descriptor.object, 'MODULE_LINK')
    const child = await read(descriptor.object, valueType)
    check(child.raw.owner.ObjectOwner === fieldId && toHex(sha3_256(child.contents)) === toHex(descriptor.body_hash), 'MODULE_BODY')
    readset.push({ id: fieldId, type: fieldType }, { id: descriptor.object, type: valueType })
    modules.push({ namespace, nameHex, valueType, objectId: descriptor.object, schema: descriptor.schema,
      removable: descriptor.removable, bodyHash: toHex(descriptor.body_hash), semanticHash: toHex(descriptor.semantic_hash) })
  }
  // A module may change while another module is read. Recheck the complete set.
  for (const row of readset) await read(row.id, row.type)
  signal.throwIfAborted()
  return { schema: 'soulidity.management-reception.v1' as const, soulId, name: root.name, revision: root.revision,
    rootVersion: rootObject.version, rootDigest: rootObject.digest,
    producer: normalizeStructTag(root.origin.producer.name), sourceType: normalizeStructTag(root.origin.source_type.name),
    sourceId: root.origin.source, sourceVersion: root.origin.source_version, sourceHash: toHex(root.origin.source_hash),
    mintedBy: root.origin.minted_by, modules, notAuthorization: true as const }
}
