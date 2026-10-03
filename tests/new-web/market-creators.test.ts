import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import type { SuiClientTypes } from '@mysten/sui/client'
import { deriveDynamicFieldID, normalizeStructTag, toBase58, fromHex } from '@mysten/sui/utils'
import { ProfileRegistryV1Bcs, WalletProfileV1Bcs, readMyWalletProfile } from '../../packages/soulidity-sdk/src/wallet-profile'
import { encodePublicWalletProfileMetadata, ProfileWalrusBlobBcs, publicWalletProfileMetadataHash } from '../../packages/soulidity-sdk/src/public-profile-metadata'
import { createMarketCreatorReader } from '../../web/lib/soulidity/market-creators'
import { id, deferred } from './fixtures/public-market'
type ReadObject = SuiClientTypes.Object<{ content: true }>

// Real creator reader -> existing profile/metadata readers -> SDK Core over
// controlled raw BCS/owned-object and Walrus byte responses. No profile mock.
async function fixture() {
  const grpc = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://unused.invalid' }), client = grpc.core
  const digest = toBase58(new Uint8Array(32).fill(1)), owner = id(200), objects = new Map<string, ReadObject>()
  const metadata = { schema: 'soulidity.public-profile.v1', displayName: 'Alice Creator', avatar: '🦊',
    bio: null, coverImageUrl: null, twitterUrl: null, websiteUrl: null }
  const bytes = encodePublicWalletProfileMetadata(metadata), hash = await publicWalletProfileMetadataHash(bytes)
  const config = { deployment: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '01010101' },
    storage: { blobType: `${id(80)}::blob::Blob`, aggregatorUrl: 'https://aggregator.example.com/' }, writesEnabled: false }
  const profile = { id: id(100), version: '1', registry_id: id(3), owner, revision: '0', handle: 'alice_works',
    metadata: { blob_object_id: id(70), blob_id: Array.from(new Uint8Array(32).fill(2)), sha256: [...fromHex(hash)], byte_length: String(bytes.length) },
    created_at_ms: '10', updated_at_ms: '10' }
  function put(objectId: string, type: string, owner: ReadObject['owner'], content: Uint8Array) {
    objects.set(objectId, { objectId, type: normalizeStructTag(type), owner, version: '1', digest, content: new Uint8Array(content),
      json: undefined, objectBcs: undefined, previousTransaction: undefined, display: undefined })
  }
  const putProfile = () => put(profile.id, `${id(1)}::profile::WalletProfileV1`, { $kind: 'AddressOwner', AddressOwner: owner }, WalletProfileV1Bcs.serialize(profile).toBytes())
  put(id(3), `${id(1)}::profile::ProfileRegistryV1`, { $kind: 'Shared', Shared: { initialSharedVersion: '1' } }, ProfileRegistryV1Bcs.serialize({
    id: id(3), version: '1', profile_count: '1', by_owner: { id: id(4), size: '1' }, by_handle: { id: id(5), size: '1' }, by_index: { id: id(6), size: '1' } }).toBytes())
  putProfile()
  const fieldId = deriveDynamicFieldID(id(4), 'address', bcs.Address.serialize(owner).toBytes())
  put(fieldId, '0x2::dynamic_field::Field<address,0x2::object::ID>', { $kind: 'ObjectOwner', ObjectOwner: id(4) },
    bcs.struct('Field', { id: bcs.Address, name: bcs.Address, value: bcs.Address }).serialize({ id: fieldId, name: owner, value: profile.id }).toBytes())
  put(id(70), config.storage.blobType, { $kind: 'AddressOwner', AddressOwner: owner }, ProfileWalrusBlobBcs.serialize({ id: id(70),
    registered_epoch: 1, blob_id: bcs.u256().parse(new Uint8Array(32).fill(2)), size: String(bytes.length), encoding_type: 1,
    certified_epoch: 2, storage: { id: id(71), start_epoch: 1, end_epoch: 10, storage_size: String(bytes.length) }, deletable: false }).toBytes())
  vi.spyOn(client, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: digest })
  const getObjects = vi.spyOn(client, 'getObjects').mockImplementation(async args => ({ objects: args.objectIds.map(objectId => objects.get(objectId) ?? new Error('missing object')) }) as never)
  const owned = vi.spyOn(client, 'listOwnedObjects').mockImplementation(async args => ({ hasNextPage: false, cursor: null,
    objects: args.owner === owner ? [objects.get(profile.id)!] : [] }) as never)
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(bytes))); vi.stubGlobal('fetch', fetcher)
  const abort = new AbortController(), reader = createMarketCreatorReader({ client, config, signal: abort.signal })
  return { grpc, client, config, owner, profile, objects, fieldId, bytes, putProfile, owned, getObjects, fetcher, abort, reader }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('reads actual public profile, exact certified Blob/hash and display name/handle without wallet signing or HTTP business APIs', async () => {
  const f = await fixture(), result = await f.reader.read([f.owner])
  expect(result[f.owner]).toEqual({ address: f.owner, status: 'VERIFIED', profileId: f.profile.id, displayName: 'Alice Creator', handle: 'alice_works', error: null })
  expect(f.owned).toHaveBeenCalledTimes(2); expect(f.fetcher).toHaveBeenCalledOnce()
  expect(f.fetcher.mock.calls[0][0]).toMatch(/^https:\/\/aggregator.example.com\/v1\/blobs\//)
  expect(f.fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' })
  expect(Object.isFrozen(result[f.owner])).toBe(true)
})
it('two complete no-owned-Profile reads mean ABSENT and never download arbitrary metadata', async () => {
  const f = await fixture(), address = id(999), result = await f.reader.read([address])
  expect(result[address]).toMatchObject({ status: 'ABSENT', profileId: null, displayName: null, handle: null, error: null })
  expect(f.fetcher).not.toHaveBeenCalled(); expect(f.owned).toHaveBeenCalledTimes(2)
})
it.each(['chain', 'owned', 'owner-index', 'profile-owner', 'blob-type', 'metadata-hash', 'storage'] as const)('%s failure is visible UNAVAILABLE, not a missing creator', async failure => {
  const f = await fixture()
  if (failure === 'chain') vi.mocked(f.client.getChainIdentifier).mockRejectedValueOnce(Error('node unavailable'))
  if (failure === 'owned') f.owned.mockRejectedValueOnce(Error('owned query failed'))
  if (failure === 'owner-index') f.objects.get(f.fieldId)!.owner = { $kind: 'ObjectOwner', ObjectOwner: id(900) }
  if (failure === 'profile-owner') f.objects.get(f.profile.id)!.owner = { $kind: 'AddressOwner', AddressOwner: id(900) }
  if (failure === 'blob-type') f.objects.get(id(70))!.type = `${id(900)}::blob::Blob`
  if (failure === 'metadata-hash') f.fetcher.mockResolvedValueOnce(new Response(new Uint8Array(f.bytes.length)))
  if (failure === 'storage') f.fetcher.mockResolvedValueOnce(new Response('down', { status: 503 }))
  const result = await f.reader.read([f.owner]); expect(result[f.owner]).toMatchObject({ status: 'UNAVAILABLE', profileId: null, displayName: null, handle: null })
  expect(result[f.owner].error).toBeTruthy()
})
it('a profile revision/handle change during metadata retrieval rejects the mixed identity and can retry', async () => {
  const f = await fixture()
  f.fetcher.mockImplementationOnce(async () => { f.profile.revision = '1'; f.profile.handle = 'alice_changed'; f.putProfile(); return new Response(new Uint8Array(f.bytes)) })
  expect((await f.reader.read([f.owner]))[f.owner]).toMatchObject({ status: 'UNAVAILABLE', error: 'MARKET_CREATOR_CHANGED_RETRY' })
  expect((await f.reader.read([f.owner], { retryFailed: true }))[f.owner]).toMatchObject({ status: 'VERIFIED', handle: 'alice_changed' })
})
it('caches only within the captured scan, retries failed identities explicitly and preserves existing known identities', async () => {
  const f = await fixture(); f.fetcher.mockRejectedValueOnce(Error('temporary failure'))
  await f.reader.read([f.owner, id(999)]); expect(f.fetcher).toHaveBeenCalledOnce()
  await f.reader.read([f.owner, id(999)]); expect(f.fetcher).toHaveBeenCalledOnce()
  expect((await f.reader.read([f.owner, id(999)], { retryFailed: true }))[f.owner].status).toBe('VERIFIED')
  expect(f.fetcher).toHaveBeenCalledTimes(2)
  const fresh = createMarketCreatorReader({ client: f.client, config: f.config, signal: f.abort.signal })
  await fresh.read([f.owner]); expect(f.fetcher).toHaveBeenCalledTimes(3)
})
it('captures configuration and requested owners before awaiting network work', async () => {
  const f = await fixture(), owners = [f.owner], held = deferred<Response>()
  f.fetcher.mockReturnValueOnce(held.promise)
  const work = f.reader.read(owners); owners[0] = id(888); f.config.deployment.registryId = id(888)
  held.resolve(new Response(new Uint8Array(f.bytes))); const result = await work
  expect(result[f.owner].status).toBe('VERIFIED'); expect(result[id(888)]).toBeUndefined()
})
it.each(['caller', 'lifetime'] as const)('%s cancellation discards late ignored-transport identity results and permits only correct retry', async mode => {
  const f = await fixture(), held = deferred<Response>(), caller = new AbortController()
  f.fetcher.mockReturnValueOnce(held.promise)
  const work = f.reader.read([f.owner], { signal: caller.signal })
  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce())
  const rejection = expect(work).rejects.toThrow(); (mode === 'caller' ? caller : f.abort).abort(); await rejection
  held.resolve(new Response(new Uint8Array(f.bytes))); await Promise.resolve()
  if (mode === 'lifetime') expect(() => f.reader.snapshot()).toThrow()
  else { expect(f.reader.snapshot()[f.owner]).toBeUndefined(); expect((await f.reader.read([f.owner]))[f.owner].status).toBe('VERIFIED') }
})
it('bounds owner workers and rejects overlapping calls while preserving the rest of a batch after one failure', async () => {
  const f = await fixture(), owners = Array.from({ length: 9 }, (_, n) => id(200 + n)), releases: (() => void)[] = []
  let active = 0, maximum = 0
  const profile = vi.fn<typeof readMyWalletProfile>(async args => {
    active++; maximum = Math.max(maximum, active)
    await new Promise<void>(resolve => releases.push(resolve)); active--
    if (args.owner === id(201)) throw new Error('one creator unavailable')
    return null
  })
  const reader = createMarketCreatorReader({ client: f.client, config: f.config, signal: f.abort.signal }, { profile })
  const work = reader.read(owners)
  await expect(reader.read([f.owner])).rejects.toThrow('BUSY')
  for (let step = 0; step < 30; step++) { releases.splice(0).forEach(release => release()); await new Promise(resolve => setTimeout(resolve, 0)) }
  const result = await work; expect(maximum).toBe(4); expect(Object.keys(result)).toHaveLength(9)
  expect(result[id(201)].status).toBe('UNAVAILABLE'); expect(result[id(208)].status).toBe('ABSENT')
})
it.each([{ owners: ['bad'] }, { owners: [id(200), id(200)] }, { owners: Array.from({ length: 10001 }, (_, n) => id(n + 1)) }])('rejects invalid or excessive owner batches without RPC', async ({ owners }) => {
  const f = await fixture(); await expect(f.reader.read(owners)).rejects.toThrow('INPUT_INVALID'); expect(f.owned).not.toHaveBeenCalled()
})
