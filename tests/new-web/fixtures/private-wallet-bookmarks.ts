import { createHash } from 'node:crypto'
import { vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { ProfileRegistryV1Bcs } from '../../../packages/soulidity-sdk/src/wallet-profile'
import { ProfileWalrusBlobBcs } from '../../../packages/soulidity-sdk/src/public-profile-metadata'
import { PrivateWalletBookmarksHeadFieldV1Bcs, derivePrivateWalletBookmarksHeadFieldId } from '../../../packages/soulidity-sdk/src/private-wallet-bookmarks'
import { readPrivateWalletBookmarksHead, readPrivateWalletBookmarksCiphertext,
  type PrivateWalletBookmarksCiphertextReadParams } from '../../../packages/soulidity-sdk/src/private-wallet-bookmarks-read'

export const bookmarkId = (value: number) => `0x${value.toString(16).padStart(64, '0')}`
export const bookmarkDigest = toBase58(new Uint8Array(32).fill(1))
export function bookmarkObjectDigest(bytes: Uint8Array) {
  // Reconstruct the full typed commitment without calling the tested reader.
  return toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...bytes]), { dkLen: 32 }))
}

/** Controlled raw ledger using actual SDK Object BCS. Dummy module bytes are
 * not a deployed/executed package or quorum certificate. Move tests separately
 * verify the real source and Seal BCS golden vector. */
export function privateWalletBookmarksFixture(scopeInput?: { registryId: string; owner: string }) {
  const deployment = { originalPackageId: bookmarkId(40), callablePackageId: bookmarkId(41), callableDigest: bookmarkDigest,
    chainIdentifier: '01010101' }
  const scope = structuredClone(scopeInput ?? { registryId: bookmarkId(42), owner: bookmarkId(43) }), pkg = deployment.originalPackageId
  const registry = { id: scope.registryId, version: '1', profile_count: '0', by_owner: { id: bookmarkId(44), size: '0' },
    by_handle: { id: bookmarkId(45), size: '0' }, by_index: { id: bookmarkId(46), size: '0' } }
  const ciphertext = new Uint8Array([4, 6, 8, 10]), hash = createHash('sha256').update(ciphertext).digest()
  const blobBytes = new Uint8Array(32).fill(7)
  const ref = { blobObjectId: bookmarkId(47), blobId: toBase64(blobBytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
    sha256: hash.toString('hex'), byteLength: String(ciphertext.length) }
  const cipherWire = { blob_object_id: ref.blobObjectId, blob_id: ref.blobId, sha256: [...hash], byte_length: ref.byteLength }
  const head = { version: 1, registry_id: scope.registryId, owner: scope.owner, revision: '2', ciphertext: structuredClone(cipherWire),
    receipts: [
      { request_id: Array(32).fill(1), revision: '1', ciphertext: structuredClone(cipherWire) },
      { request_id: Array(32).fill(2), revision: '2', ciphertext: structuredClone(cipherWire) },
    ] }
  const headFieldId = derivePrivateWalletBookmarksHeadFieldId(pkg, scope)
  const headField = { id: headFieldId, name: { version: 1, owner: scope.owner }, value: head }
  const storage = { blobType: `${bookmarkId(48)}::blob::Blob`, aggregatorUrl: 'https://walrus.example.com' }
  const blob = { id: ref.blobObjectId, registered_epoch: 1, blob_id: bcs.u256().parse(blobBytes), size: ref.byteLength,
    encoding_type: 1, certified_epoch: 2 as number | null,
    storage: { id: bookmarkId(49), start_epoch: 1, end_epoch: 10, storage_size: '4096' }, deletable: true }
  const packageData = bcs.Object.parse(bcs.Object.serialize({ data: { Package: {
    id: deployment.callablePackageId, version: '2', moduleMap: new Map([['profile', new Uint8Array([1, 2, 3])]]),
    typeOriginTable: ['ProfileRegistryV1', 'BookmarksHeadKeyV1', 'BookmarksCipherRefV1', 'BookmarksReceiptV1',
      'BookmarksHeadV1', 'BookmarksSealScopeV1'].map(datatypeName => ({ moduleName: 'profile', datatypeName, package: pkg })),
    linkageTable: new Map([[bookmarkId(2), { upgradedId: bookmarkId(2), upgradedVersion: '0' }]]),
  } }, owner: { Immutable: true }, previousTransaction: bookmarkDigest, storageRebate: '0' }).toBytes())
  const rows = new Map<string, any>(), objects = new Map<string, ReturnType<typeof bcs.Object.parse>>()
  function rehashObject(objectId: string) {
    const object = objects.get(objectId)!, move = object.data.Move
    const bytes = bcs.Object.serialize(object).toBytes()
    const owner = object.owner.$kind === 'AddressOwner' ? { kind: 1, address: object.owner.AddressOwner }
      : object.owner.$kind === 'ObjectOwner' ? { kind: 2, address: object.owner.ObjectOwner }
      : object.owner.$kind === 'Shared' ? { kind: 3, version: BigInt(object.owner.Shared.initialSharedVersion) }
      : { kind: 4 }
    const row: any = { objectId, version: BigInt(move?.version ?? object.data.Package!.version),
      digest: bookmarkObjectDigest(bytes), bcs: { value: bytes }, owner }
    if (move) {
      row.objectType = normalizeStructTag(TypeTagSerializer.tagToString({ struct: move.type.Other! }))
      row.contents = { value: new Uint8Array(move.contents) }
    } else row.package = { modules: [], typeOrigins: [], linkage: [] } // Actual official RPC omits its redundant scalars.
    rows.set(objectId, row)
    return row
  }
  function put(objectId: string, type: string, contents: Uint8Array, owner: { Shared: { initialSharedVersion: string } } | { ObjectOwner: string } | { AddressOwner: string }, hasPublicTransfer = false) {
    const tag = TypeTagSerializer.parseFromStr(type)
    if (!('struct' in tag)) throw new Error('Fixture requires a struct type')
    const object = bcs.Object.parse(bcs.Object.serialize({ data: { Move: { type: { Other: tag.struct },
      hasPublicTransfer, version: '3', contents } }, owner, previousTransaction: bookmarkDigest, storageRebate: '0' }).toBytes())
    objects.set(objectId, object); rehashObject(objectId)
  }
  const putRegistry = () => put(scope.registryId, `${pkg}::profile::ProfileRegistryV1`, ProfileRegistryV1Bcs.serialize(registry).toBytes(),
    { Shared: { initialSharedVersion: '1' } })
  const putHead = () => put(headFieldId, `0x2::dynamic_field::Field<${pkg}::profile::BookmarksHeadKeyV1,${pkg}::profile::BookmarksHeadV1>`,
    PrivateWalletBookmarksHeadFieldV1Bcs.serialize(headField).toBytes(), { ObjectOwner: scope.registryId })
  const putBlob = () => put(ref.blobObjectId, storage.blobType, ProfileWalrusBlobBcs.serialize(blob).toBytes(), { AddressOwner: scope.owner }, true)
  const putPackage = () => { objects.set(deployment.callablePackageId, packageData); deployment.callableDigest = rehashObject(deployment.callablePackageId).digest }
  putPackage(); putRegistry(); putHead(); putBlob()
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://grpc.example.com' })
  const chain = vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: bookmarkDigest })
  const batch = vi.spyOn(client.ledgerService, 'batchGetObjects').mockImplementation(((args: any) => Promise.resolve({ response: {
    objects: args.requests.map((request: any) => ({ result: rows.has(request.objectId)
      ? { oneofKind: 'object', object: structuredClone(rows.get(request.objectId)) }
      : { oneofKind: 'error', error: { code: 5 } } })) } })) as any)
  const get = vi.spyOn(client.ledgerService, 'getObject').mockImplementation(((args: any) => Promise.resolve({ response: {
    object: structuredClone(rows.get(args.objectId)) } })) as any)
  const freshWalrusState = vi.fn(async (_signal: AbortSignal) => ({ blobType: storage.blobType, epoch: 3 }))
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new Uint8Array(ciphertext)))
  const read = (signal?: AbortSignal) => readPrivateWalletBookmarksHead({ client, deployment, scope, signal })
  const readCiphertext = (extra: Partial<PrivateWalletBookmarksCiphertextReadParams> = {}) => readPrivateWalletBookmarksCiphertext({
    client, deployment, scope, storage, freshWalrusState, fetcher, ...extra })
  return { client, deployment, scope, registry, ref, ciphertext, head, headField, headFieldId, storage, blob, packageData,
    rows, objects, rehashObject, putRegistry, putHead, putBlob, putPackage, chain, batch, get, freshWalrusState, fetcher, read, readCiphertext }
}
