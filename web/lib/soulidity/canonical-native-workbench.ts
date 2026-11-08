import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../sui/move-empty-struct'
import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, fromBase58, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { profileReadStep, assertKioskItemField, KIOSK_ITEM_FIELD_TYPE, SoulPublicKioskBcs } from '@soulidity/sdk'
import { collectionCommandRaw } from '../collections/collection-command-plan'
import { historicalMoveObjectType } from '../sui/historical-object'
import { readPinnedMovePackageOrigins, type PinnedMovePackage } from '../sui/pinned-move-package'

const A = bcs.Address, S = bcs.string(), V = bcs.byteVector(), U = bcs.u64(), T = bcs.struct('TypeName', { name: S })
const Origin = bcs.struct('Origin', { producer: T, source_type: T, source: A, source_version: U, source_hash: V, minted_by: A })
const Descriptor = bcs.struct('Descriptor', { namespace: T, name: V, value_type: T, object: A, schema: bcs.u16(),
  removable: bcs.bool(), body_hash: V, semantic_hash: V })
export const CanonicalSoulBcs = bcs.struct('Soul', { id: A, schema: bcs.u16(), name: S, revision: U,
  origin: Origin, modules: bcs.vector(Descriptor), editing: bcs.bool() })
const Provenance = bcs.struct('Provenance', { kind: bcs.u8(), origin: bcs.option(S), joined: bcs.option(bcs.struct('JoinedSource', { object: A, source_type: T })) })
export const CanonicalNativeStateBcs = bcs.struct('State', { id: A, root: A, protocol: A, registry: A, schema: bcs.u16(), creator: A,
  description: S, image: S, creator_royalty_bps: bcs.u16(), created_at: U, provenance: Provenance, mint_nonce: V, content: A,
  issuer: bcs.struct('Revision', { original: A, callable: A, marker: T, version: U }) })
const Table = bcs.struct('Table', { id: A, size: U })
export const CanonicalNativeLibraryBcs = bcs.struct('Library', { id: A, root: A,
  controller: bcs.struct('Controller', { operator: T, parent: A, root: A }), revision: U,
  records: Table, counts: Table, indices: Table, active: Table,
  entries: bcs.vector(bcs.struct('Entry', { index: U, hash: V })) })
export const CanonicalNativeRecordBcs = bcs.struct('Record', { kind: bcs.u32(), name: S, version: U,
  reference: bcs.struct('Reference', { object: A, blob_id: bcs.u256(), sha256: V, bytes: U, certified_epoch: bcs.u32(), end_epoch: bcs.u32() }),
  read_mask: U, op_mask: U, scope: U, download_policy: bcs.u8(), nonce: V, envelope: V,
  deleted: bcs.bool(), purged: bcs.bool(), created_at_ms: U, seal_namespace: bcs.option(V) })
export interface CanonicalNativeContentPage {
  libraryId: string; revision: string; total: number; start: number; nextStart: number | null
  records: Array<{ index: string; kind: number; name: string; version: string; readMask: string; scope: string; downloadPolicy: number;
    deleted: boolean; purged: boolean; blobObjectId: string; ciphertextHash: string; byteLength: string;
    certifiedEpoch: number; originalEndEpoch: number; createdAtMs: string; blobIdInteger: string; nonce: string; envelopeB64: string; sealNamespaceB64: string | null }>
  notAuthorization: true
}
export const CanonicalOwnedAccountBcs = bcs.struct('Account', { id: A, kiosk: A, owner: A,
  authority: bcs.option(bcs.struct('Authority', { cap: bcs.struct('KioskOwnerCap', { id: A, for: A }), kiosk: A, owner: A, closed_digest: V })) })
export interface CanonicalNativeCustody {
  kioskId: string; ownerAddress: string; viewerMatchesOwner: boolean; accountId: string | null
  /** A current read candidate only. Actual Seal policy execution must recheck
   * the live Account/Kiosk/root; this snapshot is never authorization. */
  ownerReadCandidate: boolean; notAuthorization: true
}
export interface CanonicalNativeWorkbenchTarget {
  chainIdentifier: string; standard: PinnedMovePackage; native: PinnedMovePackage; content?: PinnedMovePackage; custody?: PinnedMovePackage; registryId: string; configId: string
}
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`NATIVE_WORKBENCH_${code}`) }
const id = (value: string) => /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
function decode<C extends { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }>(codec: C, bytes: Uint8Array): ReturnType<C['parse']> {
  const value = codec.parse(bytes); check(toBase64(codec.serialize(value).toBytes()) === toBase64(bytes), 'NONCANONICAL_CONTENTS'); return value
}
export function parseCanonicalNativeWorkbenchTarget(value: unknown): CanonicalNativeWorkbenchTarget {
  const t = structuredClone(value) as CanonicalNativeWorkbenchTarget
  function keys(v: object, expected: string[]) { check(v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).sort().join() === expected.sort().join(), 'TARGET_FIELDS') }
  keys(t, ['chainIdentifier', 'standard', 'native', 'registryId', 'configId', ...(Object.hasOwn(t, 'content') ? ['content'] : []), ...(Object.hasOwn(t, 'custody') ? ['custody'] : [])])
  check(!Object.hasOwn(t, 'custody') || Boolean(t.custody), 'TARGET_CUSTODY_PIN')
  check(!Object.hasOwn(t, 'content') || Boolean(t.content), 'TARGET_CONTENT_PIN')
  check(t.chainIdentifier === '35834a8a' && id(t.registryId) && id(t.configId), 'TARGET_INVALID')
  for (const pin of [t.standard, t.native, ...(t.content ? [t.content] : []), ...(t.custody ? [t.custody] : [])]) {
    keys(pin, ['originalPackageId', 'callablePackageId', 'callableDigest'])
    check(id(pin.originalPackageId) && id(pin.callablePackageId) && typeof pin.callableDigest === 'string', 'PACKAGE_PIN')
    const hash = fromBase58(pin.callableDigest); check(hash.length === 32 && toBase58(hash) === pin.callableDigest, 'PACKAGE_PIN')
  }
  return t
}
/** Read-only bridge for the actual new Standard/Native object layout. Its
 * snapshot proves metadata/module linkage, not full custody, edit authority,
 * content decryption, equipment compatibility or successful creation history. */
export async function readCanonicalNativeWorkbench(input: {
  client: SuiGrpcClient; target: CanonicalNativeWorkbenchTarget; soulId: string; signal: AbortSignal; contentStart?: number; viewerAddress?: string | null
}) {
  const target = parseCanonicalNativeWorkbenchTarget(input.target), soulId = input.soulId, client = input.client
  const viewer = input.viewerAddress ?? null
  check(viewer === null || id(viewer), 'VIEWER_INVALID')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)]), start = input.contentStart ?? 0
  check(Number.isSafeInteger(start) && start >= 0 && start <= 4096 && (target.content || start === 0), 'CONTENT_PAGE_INVALID')
  check(id(soulId) && id(target.registryId) && id(target.configId) && /^[0-9a-f]{8}$/.test(target.chainIdentifier), 'TARGET_INVALID')
  const chain = (await profileReadStep(signal, () => client.core.getChainIdentifier())).chainIdentifier
  check(toHex(fromBase58(chain).subarray(0, 4)) === target.chainIdentifier, 'WRONG_CHAIN')
  const [standard, native] = await Promise.all([readPinnedMovePackageOrigins(client, target.standard, signal), readPinnedMovePackageOrigins(client, target.native, signal)])
  function type(origins: Map<string, string>, module: string, name: string) {
    const origin = origins.get(`${module}::${name}`); check(origin, 'TYPE_ORIGIN_REQUIRED'); return `${origin}::${module}::${name}`
  }
  const rootType = type(standard, 'soul', 'Soul'), stateType = type(native, 'birth', 'State'), witness = type(native, 'birth', 'NativeModule')
  const producer = type(native, 'registry', 'SoulProducer'), registry = type(native, 'registry', 'Registry')
  async function read(objectId: string, expectedType: string) {
    signal.throwIfAborted()
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId,
      readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] } }, { abort: signal }))
    const row = structuredClone(response.object)
    check(row?.objectId === objectId && typeof row.version === 'bigint' && row.version > 0n && row.digest
      && row.bcs?.value instanceof Uint8Array && row.bcs.value.length > 0 && row.bcs.value.length <= 256 * 1024, 'OBJECT_UNAVAILABLE')
    const raw = collectionCommandRaw({ objectId, version: String(row.version), digest: row.digest, bcs: toBase64(row.bcs.value) }), move = raw.data.Move
    check(move && historicalMoveObjectType(move.type) === normalizeStructTag(expectedType), 'OBJECT_TYPE')
    return { raw, contents: move.contents, version: String(row.version), digest: row.digest }
  }
  const first = await read(soulId, rootType), root = decode(CanonicalSoulBcs, first.contents)
  check(root.id === soulId && root.schema === 1 && !root.editing && root.modules.length <= 64 && BigInt(root.revision) > 0n, 'ROOT_INVALID')
  check(normalizeStructTag(root.origin.producer.name) === producer && normalizeStructTag(root.origin.source_type.name) === registry
    && root.origin.source === target.registryId && root.origin.source_hash.length === 32 && BigInt(root.origin.source_version) > 0n, 'PRODUCER_MISMATCH')
  const descriptors = root.modules.filter(m => normalizeStructTag(m.namespace.name) === witness && toHex(m.name) === '6e6174697665')
  check(descriptors.length === 1, 'NATIVE_MODULE_REQUIRED'); const descriptor = descriptors[0]
  check(normalizeStructTag(descriptor.value_type.name) === stateType && descriptor.schema === 1 && !descriptor.removable
    && descriptor.body_hash.length === 32 && descriptor.semantic_hash.length === 32 && id(descriptor.object), 'MODULE_INVALID')
  const keyType = `${type(standard, 'soul', 'ModuleKey')}<${witness}>`
  const wrapperType = `0x2::dynamic_object_field::Wrapper<${keyType}>`, key = bcs.byteVector().serialize(new TextEncoder().encode('native')).toBytes()
  const fieldId = deriveDynamicFieldID(soulId, wrapperType, key)
  const field = await read(fieldId, `0x2::dynamic_field::Field<${wrapperType},0x2::object::ID>`)
  const fieldValue = decode(bcs.struct('Field', { id: A, name: bcs.struct('Wrapper', { name: bcs.struct('ModuleKey', { name: V }) }), value: A }), field.contents)
  check(field.raw.owner.ObjectOwner === soulId && fieldValue.id === fieldId && toHex(fieldValue.name.name.name) === '6e6174697665'
    && fieldValue.value === descriptor.object, 'MODULE_FIELD_BINDING')
  const stateObject = await read(descriptor.object, stateType), state = decode(CanonicalNativeStateBcs, stateObject.contents)
  check(stateObject.raw.owner.ObjectOwner === fieldId && toHex(sha3_256(stateObject.contents)) === toHex(descriptor.body_hash), 'MODULE_BODY_BINDING')
  check(state.id === descriptor.object && state.root === soulId && state.protocol === target.configId && state.registry === target.registryId
    && state.schema === 1 && state.creator === root.origin.minted_by && state.provenance.kind <= 2 && id(state.creator) && id(state.content) && state.creator_royalty_bps <= 10000
    && state.issuer.original === target.native.originalPackageId && state.mint_nonce.length > 0, 'STATE_BINDING')
  let contentDirectory: CanonicalNativeContentPage | null = null
  let recheckContent: (() => Promise<void>) | null = null
  if (target.content) {
    const origins = await readPinnedMovePackageOrigins(client, target.content, signal)
    const libraryType = type(origins, 'founding_library', 'Library'), recordType = type(origins, 'document', 'Record')
    const contentKey = type(native, 'birth', 'ContentKey'), operator = type(native, 'birth', 'ContentOperator')
    const wrapped = `0x2::dynamic_object_field::Wrapper<${contentKey}>`
    const contentFieldId = deriveDynamicFieldID(state.id, wrapped, moveEmptyStructBytes())
    const fieldType = `0x2::dynamic_field::Field<${wrapped},0x2::object::ID>`
    const contentField = await read(contentFieldId, fieldType)
    const contentLink = decode(bcs.struct('ContentField', { id: A, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: A }), contentField.contents)
    check(contentField.raw.owner.ObjectOwner === state.id && contentLink.id === contentFieldId && contentLink.value === state.content, 'CONTENT_FIELD_BINDING')
    const libraryObject = await read(state.content, libraryType), library = decode(CanonicalNativeLibraryBcs, libraryObject.contents)
    check(libraryObject.raw.owner.ObjectOwner === contentFieldId && library.id === state.content && library.root === soulId
      && library.controller.parent === state.id && library.controller.root === soulId && normalizeStructTag(library.controller.operator.name) === operator,
      'CONTENT_CONTROLLER_BINDING')
    const tableIds = [library.records.id, library.counts.id, library.indices.id, library.active.id]
    check(tableIds.every(id) && new Set([...tableIds, soulId, state.id, library.id]).size === 7
      && library.entries.length <= 4096 && BigInt(library.records.size) === BigInt(library.entries.length)
      && library.entries.every((entry, index) => entry.index === String(index) && entry.hash.length === 32), 'CONTENT_DIRECTORY_INVALID')
    check(start <= library.entries.length, 'CONTENT_PAGE_CHANGED')
    const records = await Promise.all(library.entries.slice(start, start + 25).map(async entry => {
      const fieldId = deriveDynamicFieldID(library.records.id, 'u64', bcs.u64().serialize(entry.index).toBytes())
      const row = await read(fieldId, `0x2::dynamic_field::Field<u64,${recordType}>`)
      const field = decode(bcs.struct('RecordField', { id: A, name: U, value: CanonicalNativeRecordBcs }), row.contents), record = field.value
      check(row.raw.owner.ObjectOwner === library.records.id && field.id === fieldId && field.name === entry.index
        && toHex(sha256(CanonicalNativeRecordBcs.serialize(record).toBytes())) === toHex(entry.hash), 'CONTENT_RECORD_BINDING')
      check(/^[a-z0-9_-]{1,32}$/.test(record.name) && (record.kind !== 0 || record.name === 'soul')
        && (record.kind !== 1 || record.name === 'default') && record.nonce.length === 16 && record.reference.sha256.length === 32
        && id(record.reference.object) && BigInt(record.reference.bytes) > 0n && record.reference.certified_epoch < record.reference.end_epoch
        && record.download_policy <= 2 && (BigInt(record.read_mask) & 1n) === 1n
        && (BigInt(record.read_mask) & ~15n) === 0n && ((BigInt(record.read_mask) & 8n) === 0n || record.download_policy === 0)
        && record.envelope.length <= 65536 && (record.purged ? record.deleted && record.envelope.length === 0 : record.envelope.length > 0), 'CONTENT_RECORD_INVALID')
      // Storage end epoch is the recorded original term, not live availability.
      // Permission bits are public snapshots, never decryption authorization.
      return { index: entry.index, kind: record.kind, name: record.name, version: record.version, readMask: record.read_mask, scope: record.scope,
        downloadPolicy: record.download_policy, deleted: record.deleted, purged: record.purged, blobObjectId: record.reference.object,
        ciphertextHash: toHex(record.reference.sha256), byteLength: record.reference.bytes, certifiedEpoch: record.reference.certified_epoch,
        originalEndEpoch: record.reference.end_epoch, createdAtMs: record.created_at_ms, blobIdInteger: record.reference.blob_id,
        nonce: toHex(record.nonce), envelopeB64: toBase64(record.envelope), sealNamespaceB64: record.seal_namespace === null ? null : toBase64(record.seal_namespace) }
    }))
    contentDirectory = { libraryId: library.id, revision: library.revision, total: library.entries.length, start,
      nextStart: start + records.length < library.entries.length ? start + records.length : null, records, notAuthorization: true }
    recheckContent = async () => {
      const [lastLibrary, lastField] = await Promise.all([read(library.id, libraryType), read(contentFieldId, fieldType)])
      check(lastLibrary.digest === libraryObject.digest && lastLibrary.version === libraryObject.version
        && lastField.digest === contentField.digest && lastField.version === contentField.version, 'CONTENT_CHANGED_RETRY')
    }
  }
  let custody: CanonicalNativeCustody | null = null
  let recheckCustody: (() => Promise<void>) | null = null
  if (target.custody && first.raw.owner.ObjectOwner) {
    const origins = await readPinnedMovePackageOrigins(client, target.custody, signal)
    const accountType = type(origins, 'account', 'Account')
    const itemFieldId = first.raw.owner.ObjectOwner
    const itemField = await read(itemFieldId, KIOSK_ITEM_FIELD_TYPE), kioskId = itemField.raw.owner.ObjectOwner
    check(kioskId && id(kioskId) && assertKioskItemField(itemField.contents, kioskId, soulId) === itemFieldId, 'KIOSK_ITEM_BINDING')
    const kioskObject = await read(kioskId, '0x2::kiosk::Kiosk'), kiosk = decode(SoulPublicKioskBcs, kioskObject.contents)
    check(kioskObject.raw.owner.Shared && kiosk.id === kioskId && id(kiosk.owner) && kiosk.item_count > 0, 'KIOSK_BINDING')
    let selected: { id: string; object: Awaited<ReturnType<typeof read>> } | null = null
    if (viewer === kiosk.owner) {
      let cursor: string | null | undefined, done = false
      const cursors = new Set<string>(), seen = new Set<string>()
      for (let page = 0; page < 20; page++) {
        const result = await profileReadStep(signal, () => client.core.listOwnedObjects({ owner: viewer, type: accountType, limit: 50, cursor }))
        check(result.objects.length <= 50 && typeof result.hasNextPage === 'boolean', 'ACCOUNT_PAGE_INVALID')
        for (const hint of result.objects) {
          check(id(hint.objectId) && !seen.has(hint.objectId), 'ACCOUNT_SCAN_ALIAS'); seen.add(hint.objectId)
          const object = await read(hint.objectId, accountType), account = decode(CanonicalOwnedAccountBcs, object.contents)
          check(object.raw.owner.AddressOwner === viewer && account.id === hint.objectId && account.owner === viewer, 'ACCOUNT_OWNER_MISMATCH')
          if (account.kiosk !== kioskId || account.authority === null) continue
          const authority = account.authority
          check(authority.kiosk === kioskId && authority.owner === viewer && authority.cap.for === kioskId && id(authority.cap.id)
            && new Set([account.id, authority.cap.id, kioskId, soulId]).size === 4
            && [0, 32].includes(authority.closed_digest.length), 'ACCOUNT_AUTHORITY_BINDING')
          check(selected === null, 'ACCOUNT_PAIR_AMBIGUOUS'); selected = { id: account.id, object }
        }
        if (!result.hasNextPage) { done = true; break }
        check(typeof result.cursor === 'string' && result.cursor.length > 0 && result.cursor.length <= 16384 && !cursors.has(result.cursor), 'ACCOUNT_CURSOR_INVALID')
        cursors.add(result.cursor); cursor = result.cursor
      }
      check(done, 'ACCOUNT_SCAN_INCOMPLETE')
    }
    custody = { kioskId, ownerAddress: kiosk.owner, viewerMatchesOwner: viewer === kiosk.owner, accountId: selected?.id ?? null,
      ownerReadCandidate: viewer === kiosk.owner && selected !== null, notAuthorization: true }
    const savedAccount = selected
    recheckCustody = async () => {
      const [lastKiosk, lastItem, lastAccount] = await Promise.all([read(kioskId, '0x2::kiosk::Kiosk'), read(itemFieldId, KIOSK_ITEM_FIELD_TYPE),
        savedAccount ? read(savedAccount.id, accountType) : Promise.resolve(null)])
      check(lastKiosk.digest === kioskObject.digest && lastKiosk.version === kioskObject.version
        && lastItem.digest === itemField.digest && lastItem.version === itemField.version
        && (!savedAccount || lastAccount?.digest === savedAccount.object.digest && lastAccount.version === savedAccount.object.version), 'CUSTODY_CHANGED_RETRY')
    }
  }
  const last = await read(soulId, rootType), finalState = await read(descriptor.object, stateType), finalField = await read(fieldId, `0x2::dynamic_field::Field<${wrapperType},0x2::object::ID>`)
  check(first.digest === last.digest && first.version === last.version && stateObject.digest === finalState.digest
    && stateObject.version === finalState.version && field.digest === finalField.digest && field.version === finalField.version, 'CHANGED_RETRY')
  if (recheckContent) await recheckContent()
  if (recheckCustody) await recheckCustody()
  signal.throwIfAborted()
  return { custody, contentDirectory, schema: 'soulidity.canonical-native-workbench.v1' as const, soulId, name: root.name, revision: root.revision,
    description: state.description, image: state.image, stateId: state.id, contentId: state.content, creator: state.creator,
    createdAtMs: state.created_at, royaltyBps: state.creator_royalty_bps, provenanceKind: state.provenance.kind,
    producer, registryId: state.registry, custodyObject: first.raw.owner.ObjectOwner ?? null,
    authority: 'verified-native-metadata-only' as const, notAuthorization: true as const }
}
