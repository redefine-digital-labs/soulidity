import { deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '../../../packages/soulidity-sdk/src/kiosk-item-custody'
import { createHash } from 'node:crypto'
import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { SoulPublicBcs, SoulStatePublicBcs, SoulStatePointerFieldV1Bcs } from '../../../packages/soulidity-sdk/src/soul-public-read'
import { ProfileWalrusBlobBcs } from '../../../packages/soulidity-sdk/src/public-profile-metadata'
import { PrivateNamedLoadoutHeadFieldV1Bcs, derivePrivateNamedLoadoutHeadFieldId } from '../../../packages/soulidity-sdk/src/private-named-loadout'
import { readPrivateNamedLoadoutHead, readPrivateNamedLoadoutCiphertext,
  type PrivateNamedLoadoutCiphertextReadParams } from '../../../packages/soulidity-sdk/src/private-named-loadout-read'

export const privateId = (value: number) => `0x${value.toString(16).padStart(64, '0')}`
export const privateDigest = toBase58(new Uint8Array(32).fill(1))
export function privateNamedLoadoutFixture() {
  const deployment = { originalPackageId: privateId(1), callablePackageId: privateId(20), chainIdentifier: '01010101' }
  const scope = { soulId: privateId(3), stateId: privateId(2), owner: privateId(5), ownershipEpoch: '2' }
  const pkg = deployment.originalPackageId
  const state = { id: scope.stateId, version: '1', soul_id: scope.soulId, creator: privateId(4), creator_royalty_bps: 500,
    current_owner: scope.owner, current_kiosk_id: privateId(6), ownership_epoch: scope.ownershipEpoch, grant_capacity: '3',
    active_grants: { id: privateId(7), size: '0' }, active_grant_ids: { id: privateId(8), size: '0' }, active_grant_count: '0',
    content_id: privateId(9), config_ext: { id: privateId(10), size: '0' }, collection_id: null as string | null,
    access_list_id: privateId(11), is_listed: false }
  const soul = { id: scope.soulId, version: '1', name: 'Soul', description: '', image_url: '', provenance_kind: 1,
    origin_ref: null as string | null, creator: state.creator }
  const ciphertext = new Uint8Array([4, 6, 8, 10])
  const hash = createHash('sha256').update(ciphertext).digest()
  const blobIdBytes = new Uint8Array(32).fill(7)
  const blobId = toBase64(blobIdBytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const ref = { blobObjectId: privateId(12), blobId, sha256: hash.toString('hex'), byteLength: String(ciphertext.length) }
  const capture = { equipmentId: privateId(15), revision: '7', commitment: 'bb'.repeat(32) }
  const cipherWire = { blob_object_id: ref.blobObjectId, blob_id: ref.blobId, sha256: [...hash], byte_length: ref.byteLength }
  const captureWire = { equipment_id: capture.equipmentId, revision: capture.revision, commitment: Array(32).fill(187) }
  const head = { version: 1, soul_id: scope.soulId, state_id: scope.stateId, owner: scope.owner,
    ownership_epoch: scope.ownershipEpoch, revision: '2', ciphertext: cipherWire,
    receipts: [
      { request_id: Array(32).fill(1), revision: '1', ciphertext: structuredClone(cipherWire), capture: captureWire as typeof captureWire | null },
      { request_id: Array(32).fill(2), revision: '2', ciphertext: structuredClone(cipherWire), capture: null as typeof captureWire | null },
    ] }
  const headFieldId = derivePrivateNamedLoadoutHeadFieldId(pkg, scope.stateId)
  const headField = { id: headFieldId, name: { version: 1 }, value: head }
  const pointerType = `${pkg}::soul::SoulStatePointerKeyV1`
  const pointerId = deriveDynamicFieldID(scope.soulId, pointerType, new Uint8Array([1]))
  const pointer = { id: pointerId, name: { version: 1 }, value: scope.stateId }
  const storage = { blobType: `${privateId(16)}::blob::Blob`, aggregatorUrl: 'https://walrus.example.com' }
  const blob = { id: ref.blobObjectId, registered_epoch: 1, blob_id: bcs.u256().parse(blobIdBytes), size: ref.byteLength,
    encoding_type: 1, certified_epoch: 2 as number | null,
    storage: { id: privateId(13), start_epoch: 1, end_epoch: 10, storage_size: '4096' }, deletable: true }
  const rows = new Map<string, any>()
  function put(objectId: string, type: string, bytes: Uint8Array, owner: any) {
    rows.set(objectId, { objectId, objectType: normalizeStructTag(type), version: 3n, digest: privateDigest, owner, contents: { value: bytes } })
  }
  const putState = () => put(state.id, `${pkg}::soul::SoulState`, SoulStatePublicBcs.serialize(state).toBytes(), { kind: 3, version: 1n })
  const putSoul = () => {
    const fieldId = deriveKioskItemFieldId(state.current_kiosk_id, soul.id)
    put(fieldId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs.serialize({ id: fieldId, name: { name: { id: soul.id } }, value: soul.id }).toBytes(),
      { kind: 2, address: state.current_kiosk_id })
    put(soul.id, `${pkg}::soul::Soul`, SoulPublicBcs.serialize(soul).toBytes(), { kind: 2, address: fieldId })
  }
  const putPointer = () => put(pointerId, `0x2::dynamic_field::Field<${pointerType},0x2::object::ID>`,
    SoulStatePointerFieldV1Bcs.serialize(pointer).toBytes(), { kind: 2, address: scope.soulId })
  const putHead = () => put(headFieldId, `0x2::dynamic_field::Field<${pkg}::soul::NamedLoadoutHeadKeyV1,${pkg}::named_loadout_v1::HeadV1>`,
    PrivateNamedLoadoutHeadFieldV1Bcs.serialize(headField).toBytes(), { kind: 2, address: scope.stateId })
  const putBlob = () => put(ref.blobObjectId, storage.blobType, ProfileWalrusBlobBcs.serialize(blob).toBytes(), { kind: 1, address: scope.owner })
  putState(); putSoul(); putPointer(); putHead(); putBlob()
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://grpc.example.com' })
  const chain = vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: privateDigest })
  const batch = vi.spyOn(client.ledgerService, 'batchGetObjects').mockImplementation(((args: any) => Promise.resolve({ response: {
    objects: args.requests.map((request: any) => ({ result: rows.has(request.objectId)
      ? { oneofKind: 'object', object: structuredClone(rows.get(request.objectId)) }
      : { oneofKind: 'error', error: { code: 5 } } })) } })) as any)
  const get = vi.spyOn(client.ledgerService, 'getObject').mockImplementation(((args: any) => Promise.resolve({ response: {
    object: structuredClone(rows.get(args.objectId)) } })) as any)
  const freshWalrusState = vi.fn(async (_signal: AbortSignal) => ({ blobType: storage.blobType, epoch: 3 }))
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new Uint8Array(ciphertext)))
  const read = (signal?: AbortSignal) => readPrivateNamedLoadoutHead({ client, deployment, scope, signal })
  const readCiphertext = (extra: Partial<PrivateNamedLoadoutCiphertextReadParams> = {}) => readPrivateNamedLoadoutCiphertext({
    client, deployment, scope, storage, freshWalrusState, fetcher, ...extra })
  return { client, deployment, scope, state, soul, ref, capture, ciphertext, head, headField, headFieldId,
    pointer, pointerId, storage, blob, rows, putState, putSoul, putPointer, putHead, putBlob,
    chain, batch, get, freshWalrusState, fetcher, read, readCiphertext }
}
