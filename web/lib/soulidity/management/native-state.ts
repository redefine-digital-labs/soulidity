import { readNativePublicReadOverviewV2 } from '../native-public-read-record-v2'
import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { profileReadStep } from '@soulidity/sdk'
import { collectionCommandRaw } from '../../collections/collection-command-plan'
import { historicalMoveObjectType } from '../../sui/historical-object'
import { readPinnedMovePackageOrigins } from '../../sui/pinned-move-package'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { CanonicalNativeLibraryBcs, CanonicalNativeRecordBcs, readCanonicalNativeWorkbench, type CanonicalNativeWorkbenchTarget } from '../canonical-native-workbench'
import { NativeInitialAuthorizationBcs, NativeInitialConfigurationBcs } from '../native-initial-children'

const A = bcs.Address, U = bcs.u64()
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_STATE_${code}`) }
function canonical<C extends { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }>(codec: C, bytes: Uint8Array): ReturnType<C['parse']> {
  const value = codec.parse(bytes)
  check(toBase64(codec.serialize(value).toBytes()) === toBase64(bytes), 'NONCANONICAL'); return value
}

/** Public configuration, authorization generation and actual active bindings.
 * No decrypted document, personal-message session or authority is persisted.
 * The complete readset plus final canonical root/custody check rejects changes.
 * Table discovery supplies keys only; raw typed fields and committed table size
 * prove each entry and completeness within the explicit bounded reader. */
type ManagementStateInput = {
  client: SuiGrpcClient; target: CanonicalNativeWorkbenchTarget; soulId: string
  viewerAddress: string | null; getViewerAddress: () => string | null; signal: AbortSignal
}
export async function readNativeManagementState(input: ManagementStateInput) { return readManagementState(input, 'LEGACY_STATE_V1') }
/** Explicit schema2 only. Embedded State UID owns children; Host is not a
 * standalone State and Link commitment is not a children commitment. */
export async function readNativeHostManagementStateV2(input: ManagementStateInput) { return readManagementState(input, 'PUBLIC_READ_HOST_V2') }
async function readManagementState(input: ManagementStateInput, format: 'LEGACY_STATE_V1' | 'PUBLIC_READ_HOST_V2') {
  const { client, soulId, viewerAddress, signal } = input, target = structuredClone(input.target)
  check(target.content, 'CONTENT_PIN_REQUIRED')
  const guard = () => { signal.throwIfAborted(); check(input.getViewerAddress() === viewerAddress, 'WALLET_CHANGED') }
  guard()
  const readBase = () => format === 'PUBLIC_READ_HOST_V2' ? readNativePublicReadOverviewV2({ client, target, soulId, signal }) : readCanonicalNativeWorkbench({ client, target, soulId, viewerAddress, signal })
  const base = await readBase()
  guard()
  const nativeOrigins = await readPinnedMovePackageOrigins(client, target.native, signal)
  const contentOrigins = await readPinnedMovePackageOrigins(client, target.content, signal)
  const type = (origins: Map<string, string>, module: string, name: string) => {
    const origin = origins.get(`${module}::${name}`); check(origin, 'TYPE_ORIGIN'); return `${origin}::${module}::${name}`
  }
  const objects = new Map<string, { type: string; version: string; digest: string }>()
  async function read(objectId: string, expectedType: string) {
    guard()
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId,
      readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] } }, { abort: signal }))
    guard()
    const row = response.object
    check(row?.objectId === objectId && typeof row.version === 'bigint' && row.version > 0n && row.digest
      && row.bcs?.value instanceof Uint8Array && row.bcs.value.length <= 256 * 1024, 'OBJECT')
    const raw = collectionCommandRaw({ objectId, version: String(row.version), digest: row.digest, bcs: toBase64(row.bcs.value) }), move = raw.data.Move
    check(move && historicalMoveObjectType(move.type) === normalizeStructTag(expectedType), 'TYPE')
    const previous = objects.get(objectId)
    check(!previous || previous.type === expectedType && previous.version === String(row.version) && previous.digest === row.digest, 'CHANGED_RETRY')
    objects.set(objectId, { type: expectedType, version: String(row.version), digest: row.digest })
    return { raw, bytes: move.contents, reference: { version: String(row.version), digest: row.digest } }
  }
  async function child(key: string, module: string, name: string) {
    const wrapped = `0x2::dynamic_object_field::Wrapper<${type(nativeOrigins, 'birth', key)}>`
    const fieldId = deriveDynamicFieldID(base.stateId, wrapped, moveEmptyStructBytes())
    const field = await read(fieldId, `0x2::dynamic_field::Field<${wrapped},0x2::object::ID>`)
    const link = canonical(bcs.struct('Field', { id: A, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: A }), field.bytes)
    check(link.id === fieldId && link.name.name.dummy_field === false && field.raw.owner.ObjectOwner === base.stateId, 'CHILD_FIELD')
    const object = await read(link.value, type(contentOrigins, module, name))
    check(object.raw.owner.ObjectOwner === fieldId, 'CHILD_OWNER'); return object.bytes
  }
  const configuration = canonical(NativeInitialConfigurationBcs, await child('ConfigurationKey', 'state_configuration', 'Configuration'))
  const authorization = canonical(NativeInitialAuthorizationBcs, await child('AuthorizationKey', 'authorization', 'Authorization'))
  const operator = type(nativeOrigins, 'birth', 'ContentOperator')
  for (const value of [configuration, authorization]) check(value.root === soulId && value.controller.root === soulId
    && value.controller.parent === base.stateId && normalizeStructTag(value.controller.operator.name) === operator, 'CONTROLLER')
  check(configuration.entries.length <= 256 && BigInt(configuration.entries.length) === BigInt(configuration.values.size), 'CONFIGURATION_BOUND')
  // Clearing increments generation in constant work. Old physical rows remain
  // queryable for cleanup but no longer consume current-generation capacity.
  check(BigInt(authorization.count) <= BigInt(authorization.capacity)
    && BigInt(authorization.count) <= BigInt(authorization.grants.size) && BigInt(authorization.capacity) <= 10000n, 'AUTHORIZATION_COUNT')
  const keys = new Set<string>(), values = []
  for (const entry of configuration.entries) {
    check(entry.key.length > 0 && entry.key.length <= 4096 && !keys.has(entry.key) && entry.value_hash.length === 32, 'CONFIGURATION_KEY')
    keys.add(entry.key)
    const id = deriveDynamicFieldID(configuration.values.id, '0x1::string::String', bcs.string().serialize(entry.key).toBytes())
    const row = await read(id, '0x2::dynamic_field::Field<0x1::string::String,vector<u8>>')
    const field = canonical(bcs.struct('Value', { id: A, name: bcs.string(), value: bcs.byteVector() }), row.bytes)
    check(field.id === id && field.name === entry.key && row.raw.owner.ObjectOwner === configuration.values.id
      && toHex(sha256(field.value)) === toHex(entry.value_hash), 'CONFIGURATION_VALUE')
    values.push({ key: entry.key, valueB64: toBase64(field.value), hash: toHex(entry.value_hash) })
  }
  const libraryRow = await read(base.contentId, type(contentOrigins, 'founding_library', 'Library'))
  const library = canonical(CanonicalNativeLibraryBcs, libraryRow.bytes)
  check(library.id === base.contentId && library.root === soulId, 'LIBRARY')
  if ('contentDirectory' in base) check(library.revision === base.contentDirectory?.revision, 'LIBRARY_REVISION')
  else check(libraryRow.reference.version === base.libraryReference.version && libraryRow.reference.digest === base.libraryReference.digest, 'LIBRARY_REVISION')
  check(BigInt(library.active.size) <= 256n, 'ACTIVE_BOUND')
  const active = [], fieldIds = new Set<string>(), cursors = new Set<string>()
  let cursor: string | null = null, done = false
  for (let page = 0; page < 16; page++) {
    if (library.active.size === '0') { done = true; break }
    const result = await profileReadStep(signal, () => client.core.listDynamicFields({ parentId: library.active.id, limit: 25, cursor, signal }))
    guard(); check(result.dynamicFields.length <= 25 && typeof result.hasNextPage === 'boolean', 'ACTIVE_PAGE')
    for (const hint of result.dynamicFields) {
      check(hint.$kind === 'DynamicField' && hint.name.type === 'u32' && hint.valueType === 'u64'
        && normalizeStructTag(hint.type) === normalizeStructTag('0x2::dynamic_field::Field<u32,u64>'), 'ACTIVE_TYPE')
      const kind = canonical(bcs.u32(), hint.name.bcs), id = deriveDynamicFieldID(library.active.id, 'u32', bcs.u32().serialize(kind).toBytes())
      check(id === hint.fieldId && !fieldIds.has(id), 'ACTIVE_ALIAS'); fieldIds.add(id)
      check(fieldIds.size <= 256, 'ACTIVE_BOUND')
      const row = await read(id, '0x2::dynamic_field::Field<u32,u64>')
      const field = canonical(bcs.struct('Active', { id: A, name: bcs.u32(), value: U }), row.bytes)
      check(field.id === id && field.name === kind && row.raw.owner.ObjectOwner === library.active.id
        && BigInt(field.value) < BigInt(library.entries.length), 'ACTIVE_BINDING')
      const recordId = deriveDynamicFieldID(library.records.id, 'u64', U.serialize(field.value).toBytes())
      const recordRow = await read(recordId, `0x2::dynamic_field::Field<u64,${type(contentOrigins, 'document', 'Record')}>`)
      const recordField = canonical(bcs.struct('RecordField', { id: A, name: U, value: CanonicalNativeRecordBcs }), recordRow.bytes)
      const record = recordField.value, entry = library.entries[Number(field.value)]
      check(recordField.id === recordId && recordField.name === field.value && recordRow.raw.owner.ObjectOwner === library.records.id
        && entry.index === field.value && toHex(entry.hash) === toHex(sha256(CanonicalNativeRecordBcs.serialize(record).toBytes()))
        && record.kind === kind && !record.deleted && !record.purged && (BigInt(record.op_mask) & 8n) !== 0n, 'ACTIVE_RECORD')
      active.push({ kind, index: field.value, name: record.name, version: record.version })
    }
    if (!result.hasNextPage) { done = true; break }
    check(typeof result.cursor === 'string' && result.cursor.length > 0 && result.cursor.length <= 16384 && !cursors.has(result.cursor), 'ACTIVE_CURSOR')
    cursors.add(result.cursor); cursor = result.cursor
  }
  check(done && BigInt(active.length) === BigInt(library.active.size), 'ACTIVE_INCOMPLETE')
  for (const [id, object] of objects) await read(id, object.type)
  const final = await readBase()
  const stableBase = (value: typeof base) => { if ('clockTimestampMs' in value) { const { clockTimestampMs: _, ...business } = value; return business } return value }
  if ('clockTimestampMs' in base && 'clockTimestampMs' in final) check(BigInt(final.clockTimestampMs) >= BigInt(base.clockTimestampMs), 'CLOCK_REWIND')
  check(JSON.stringify(stableBase(base)) === JSON.stringify(stableBase(final)), 'SOURCE_CHANGED_RETRY'); guard()
  return { soulId, stateId: base.stateId, contentId: base.contentId, format, nativeOriginalPackageId: target.native.originalPackageId, nativeCallablePackageId: target.native.callablePackageId, registryId: target.registryId, configId: target.configId,
    ...( 'hostId' in base ? { hostId: base.hostId, clockTimestampMs: 'clockTimestampMs' in final ? final.clockTimestampMs : base.clockTimestampMs, hostObjectReference: base.hostReference, libraryObjectReference: base.libraryReference, kioskObjectReference: base.kioskReference, rootVersion: base.reception.rootVersion, rootDigest: base.reception.rootDigest, ownerAddress: base.ownerAddress, rootRevision: base.reception.revision, hostReference: base.shared.host, kioskReference: base.shared.kiosk, requiresQualifiedSourceAndFormatAdoption: true as const } : {} ),
    configuration: { id: configuration.id, revision: configuration.revision, values },
    authorization: { id: authorization.id, generation: authorization.generation, grantCount: authorization.count, retainedRowCount: authorization.grants.size },
    activeContent: active.sort((a, b) => a.kind - b.kind), libraryRevision: library.revision, notAuthorization: true as const }
}
