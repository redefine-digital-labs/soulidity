import { expect, it, vi } from 'vitest'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { UnaryCall } from '@protobuf-ts/runtime-rpc'
import type { SoulPublicSnapshot } from '../../packages/soulidity-sdk/src/soul-public-read'
import { resolveBrowserNativeListingDeployment } from '../../web/lib/soulidity/browser-native-listing-authority'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { fixtureKioskItem } from './fixtures/native-receive'
import { NativeSoulBcs, NativeSoulBindingBcs, NativeSoulStateBcs } from '../../web/lib/animacraft/native-receive'
import { EquipmentMakerBcs, EquipmentProtocolBcs } from '../../web/lib/animacraft/native-equipment-source-bcs'
import { EquipmentPointerBcs } from '../../web/lib/animacraft/native-equipment'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
function fixture() {
  const f = nativeEquipmentSourceFixture()
  // Output and Soulidity select the same exact Core dependency on the current
  // production graph. No Runtime pin is required by this read-only consumer.
  f.objects.get(id(4)).package.linkage.push({ originalId: id(2), upgradedId: id(72), upgradedVersion: 1n })
  for (const row of f.objects.values()) if (row.owner?.kind === 3) row.owner.version = 1n
  const state = NativeSoulStateBcs.parse(f.objects.get(id(14)).contents.value)
  const soul = NativeSoulBcs.parse(f.objects.get(id(12)).contents.value)
  const snapshot: SoulPublicSnapshot = { soulId: soul.id, stateId: state.id, stateVersion: '2',
    stateDigest: f.objects.get(state.id).digest, creator: state.creator, currentOwner: state.current_owner,
    kioskId: state.current_kiosk_id, name: soul.name, description: soul.description, imageUrl: soul.image_url,
    provenanceKind: 3, originRef: soul.origin_ref, creatorRoyaltyBps: state.creator_royalty_bps,
    ownershipEpoch: state.ownership_epoch, collectionId: state.collection_id, listedIndividually: state.is_listed,
    contentId: state.content_id!, createdAtMs: '1', publicPreview: { schema: 'soulidity.soul-public-preview.v1', tags: [], previewImages: [] } }
  const { runtime: _runtime, ...target } = f.target
  const method = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://grpc.example.com' })
    .ledgerService.methods.find(method => method.name === 'GetObject')!
  const get = vi.spyOn(f.client.ledgerService, 'getObject').mockImplementation(((request: any) => {
    f.calls.push(request)
    // Real UnaryCall + SDK reflection (including non-cloneable functions), not
    // an async function pretending to implement a gRPC method. No HTTP is sent.
    return new UnaryCall(method, {}, request, Promise.resolve({}),
      Promise.resolve({ object: f.objects.get(request.objectId) }),
      Promise.resolve({ code: 'OK', detail: '' }), Promise.resolve({}))
  }) as any)
  const read = (signal?: AbortSignal) => resolveBrowserNativeListingDeployment({ client: f.client, target, snapshot, signal })
  return { ...f, target, snapshot, get, read }
}

it('derives the per-Maker registry from raw publication and exact package linkage without Runtime/Seal reads', async () => {
  const f = fixture()
  expect(await f.read()).toEqual({ outputOriginalPackageId: id(3), protocolConfigId: id(1), soulRegistryId: id(19) })
  expect(f.get.mock.calls.map(([request]) => request.objectId)).not.toEqual(expect.arrayContaining([id(71), id(87)]))
  expect(f.get.mock.calls.every(([request]) => !Object.hasOwn(request, 'version'))).toBe(true)
  expect(f.get.mock.calls.every(([, options]) => options?.abort instanceof AbortSignal)).toBe(true)
  expect(f.get.mock.results.every(result => result.value instanceof UnaryCall)).toBe(true)
  expect(f.get.mock.results[0].value.method.name).toBe('GetObject')
  expect(Object.isFrozen(await f.read())).toBe(true)
})
it.each([0, 1, 2])('ordinary provenance %i does not require native configuration or native reads', async provenance => {
  const f = fixture(); f.snapshot.provenanceKind = provenance as 0 | 1 | 2
  expect(await f.read()).toBeUndefined(); expect(f.get).not.toHaveBeenCalled()
})
it.each([1, 2, 3])('a published Maker lifecycle %i remains readable without current activity permission', async lifecycle => {
  const f = fixture(); f.set(id(10), EquipmentMakerBcs, root => { root.lifecycle = lifecycle })
  f.set(id(1), EquipmentProtocolBcs, protocol => { protocol.enabled = false; protocol.revision = '9' })
  expect(await f.read()).toMatchObject({ soulRegistryId: id(19) })
})
it('retains a transferred holder instead of confusing Maker creator or original holder with current owner', async () => {
  const f = fixture(); f.snapshot.currentOwner = id(101); f.snapshot.kioskId = id(102); f.snapshot.ownershipEpoch = '8'
  f.set(id(14), NativeSoulStateBcs, state => {
    state.current_owner = id(101); state.current_kiosk_id = id(102); state.ownership_epoch = '8'
  })
  fixtureKioskItem(f.objects, id(102), id(12))
  expect(await f.read()).toMatchObject({ soulRegistryId: id(19) })
})

it.each(['state-version', 'state-digest', 'state-soul', 'state-owner', 'state-kiosk', 'state-epoch', 'state-schema',
  'soul-name', 'soul-provenance', 'soul-owner', 'df-key', 'df-uid', 'df-parent',
  'binding-id', 'binding-soul', 'binding-state', 'binding-protocol', 'binding-owner', 'binding-mutable',
  'root-id', 'root-version', 'root-maker-version', 'root-core-original', 'root-core-callable', 'root-protocol',
  'root-coin', 'root-creator', 'root-treasury', 'root-content', 'root-draft', 'root-publication', 'registry-substitution']) (
  'rejects %s authority substitution', async part => {
    const f = fixture()
    const state = (change: (row: any) => void) => f.set(id(14), NativeSoulStateBcs, change)
    const soul = (change: (row: any) => void) => f.set(id(12), NativeSoulBcs, change)
    const binding = (change: (row: any) => void) => f.set(id(13), NativeSoulBindingBcs, change)
    const root = (change: (row: any) => void) => f.set(id(10), EquipmentMakerBcs, change)
    if (part === 'state-version') f.snapshot.stateVersion = '1'
    if (part === 'state-digest') f.snapshot.stateDigest = 'different'
    if (part === 'state-soul') state(row => { row.soul_id = id(90) })
    if (part === 'state-owner') state(row => { row.current_owner = id(90) })
    if (part === 'state-kiosk') state(row => { row.current_kiosk_id = id(90) })
    if (part === 'state-epoch') state(row => { row.ownership_epoch = '1' })
    if (part === 'state-schema') state(row => { row.version = '2' })
    if (part === 'soul-name') soul(row => { row.name = 'other' })
    if (part === 'soul-provenance') soul(row => { row.provenance_kind = 0 })
    if (part === 'soul-owner') f.objects.get(id(12)).owner.address = id(90)
    if (part === 'df-key') f.set(f.dfId, EquipmentPointerBcs, row => { row.name = 10 })
    if (part === 'df-uid') f.set(f.dfId, EquipmentPointerBcs, row => { row.id = id(90) })
    if (part === 'df-parent') f.objects.get(f.dfId).owner.address = id(90)
    if (part === 'binding-id') binding(row => { row.id = id(90) })
    if (part === 'binding-soul') binding(row => { row.soul_id = id(90) })
    if (part === 'binding-state') binding(row => { row.soul_state_id = id(90) })
    if (part === 'binding-protocol') binding(row => { row.protocol_config_id = id(90) })
    if (part === 'binding-owner') binding(row => { row.original_holder = id(90) })
    if (part === 'binding-mutable') f.objects.get(id(13)).owner = { kind: 3, version: 1n }
    if (part === 'root-id') root(row => { row.id = id(90) })
    if (part === 'root-version') root(row => { row.version = '9' })
    if (part === 'root-maker-version') root(row => { row.maker_version = '2' })
    if (part === 'root-core-original') root(row => { row.core_original_package_id = id(90) })
    if (part === 'root-core-callable') root(row => { row.core_callable_package_id = id(90) })
    if (part === 'root-protocol') root(row => { row.economics.protocol_config_id = id(90) })
    if (part === 'root-coin') root(row => { row.economics.payment_coin_type = `${id(2)}::wrong::Coin` })
    if (part === 'root-creator') root(row => { row.creator = id(90) })
    if (part === 'root-treasury') root(row => { row.maker_treasury_id = id(90) })
    if (part === 'root-content') root(row => { row.content.content_commitment[0] ^= 1 })
    if (part === 'root-draft') root(row => { row.lifecycle = 0 })
    if (part === 'root-publication') root(row => { row.publication.registry_ids = null })
    if (part === 'registry-substitution') binding(row => { row.soul_registry_id = id(90) })
    await expect(f.read()).rejects.toThrow()
  },
)
it.each(['missing-link', 'different-link', 'duplicate-link', 'core-id', 'core-original', 'core-version',
  'core-owner', 'root-origin', 'marker-origin', 'protocol-origin', 'module-bytes', 'root-raw-type', 'root-type-arity']) (
  'rejects exact package/type evidence %s', async part => {
    const f = fixture(), output = f.objects.get(id(4)).package, core = f.objects.get(id(72))
    if (part === 'missing-link') output.linkage = output.linkage.filter((row: any) => row.originalId !== id(2))
    if (part === 'different-link') output.linkage.find((row: any) => row.originalId === id(2)).upgradedId = id(90)
    if (part === 'duplicate-link') output.linkage.push({ originalId: id(2), upgradedId: id(72), upgradedVersion: 1n })
    if (part === 'core-id') core.objectId = id(90)
    if (part === 'core-original') core.package.originalId = id(90)
    if (part === 'core-version') core.version = 2n
    if (part === 'core-owner') core.owner.kind = 1
    if (part === 'root-origin') core.package.typeOrigins.find((row: any) => row.datatypeName === 'MakerRootV8').packageId = id(90)
    if (part === 'marker-origin') core.package.typeOrigins.find((row: any) => row.datatypeName === 'CorePackageMarkerV8').packageId = id(90)
    if (part === 'protocol-origin') core.package.typeOrigins.find((row: any) => row.datatypeName === 'ProtocolConfigV8').packageId = id(90)
    if (part === 'module-bytes') core.package.modules.find((row: any) => row.name === 'maker_v8').contents = new Uint8Array()
    if (part === 'root-raw-type') f.objects.get(id(10)).objectType = `${id(90)}::maker_v8::MakerRootV8<${id(2)}::sui::SUI>`
    if (part === 'root-type-arity') f.objects.get(id(10)).objectType = `${id(2)}::maker_v8::MakerRootV8`
    await expect(f.read()).rejects.toThrow()
  },
)
it.each([id(14), id(12), id(10), id(1)])('rejects %s changing before final readset verification', async changed => {
  const f = fixture(), original = f.get.getMockImplementation()!, counts = new Map<string, number>()
  f.get.mockImplementation(((request: any) => {
    counts.set(request.objectId, (counts.get(request.objectId) ?? 0) + 1)
    if (request.objectId === changed && counts.get(request.objectId) === 2) f.objects.get(changed).version = 3n
    return original(request)
  }) as any)
  await expect(f.read()).rejects.toThrow('Equipment changed')
})
it('captures target and metadata before the first asynchronous lookup', async () => {
  const f = fixture(); let release!: () => void
  const original = f.client.core.getChainIdentifier.bind(f.client.core)
  vi.spyOn(f.client.core, 'getChainIdentifier').mockImplementationOnce(() => new Promise(resolve => {
    release = () => { void original().then(resolve) }
  }))
  const reading = f.read()
  f.target.protocolConfigId = id(90); f.snapshot.stateVersion = '99'; f.snapshot.soulId = id(90)
  await vi.waitFor(() => expect(release).toBeTypeOf('function')); release()
  expect(await reading).toMatchObject({ protocolConfigId: id(1) })
})
it('cancels an uncooperative attestation without reading any provenance or publishing a late result', async () => {
  const f = fixture(), controller = new AbortController()
  vi.spyOn(f.client.core, 'getChainIdentifier').mockImplementationOnce(() => new Promise(() => {}))
  const reading = f.read(controller.signal)
  controller.abort(new Error('cancel authority'))
  await expect(reading).rejects.toThrow('cancel authority'); expect(f.get).not.toHaveBeenCalled()
})

it('bounds an uncooperative actual UnaryCall and prevents late continuation after abort', async () => {
  const f = fixture(), controller = new AbortController(), original = f.get.getMockImplementation()!
  let release!: () => void
  f.get.mockImplementationOnce(((request: any, options: any) => {
    const call = original(request, options)
    const response = new Promise<any>(resolve => { release = () => resolve({ object: f.objects.get(request.objectId) }) })
    return new UnaryCall(call.method, {}, request, Promise.resolve({}), response,
      Promise.resolve({ code: 'OK', detail: '' }), Promise.resolve({}))
  }) as any)
  const reading = f.read(controller.signal)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  controller.abort(new Error('cancel unary'))
  await expect(reading).rejects.toThrow('cancel unary')
  const count = f.get.mock.calls.length
  release(); await new Promise(resolve => setTimeout(resolve, 0))
  expect(f.get).toHaveBeenCalledTimes(count)
  expect(f.get.mock.calls.some(([request]) => request.objectId === id(14))).toBe(false)
})
