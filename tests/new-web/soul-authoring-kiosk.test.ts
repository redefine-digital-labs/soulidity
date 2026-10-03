import { expect, it, vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, normalizeStructTag, toBase58, toHex } from '@mysten/sui/utils'
import { CollectionKioskRegistryBcs, CollectionKioskRegistrationFieldBcs, CollectionPersonalKioskCapBcs,
  SoulPublicKioskBcs, SOUL_PUBLIC_USDC_TYPE } from '@soulidity/sdk'
import { collectionCommandHash, collectionCommandRegistration } from '../../web/lib/collections/collection-command-plan'
import { collectionBuyTypes, collectionBuyOwnerMarker, CollectionBuyOwnerMarkerBcs } from '../../web/lib/collections/collection-buy-plan'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'
import { resolveSoulAuthoringKiosk } from '../../web/lib/soulidity/soul-authoring-kiosk'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const prior = toBase58(new Uint8Array(32).fill(1))
function fixture(existing = true) {
  const target = { chainIdentifier: toHex(fromBase58(MAINNET_GENESIS_DIGEST).subarray(0, 4)), originalPackageId: id(1),
    callablePackageId: id(2), callableDigest: prior, marketConfigId: id(3), kioskRegistryId: id(4), personalKioskTypePackageId: id(5),
    paymentCoinType: SOUL_PUBLIC_USDC_TYPE, collectionTransferPolicyId: id(6), kioskPackageId: id(7), kindRegistryId: id(8),
    soulTransferPolicyId: id(9), blobBaseUrl: 'https://aggregator.example' }
  const author = id(10), kioskId = id(11), capId = id(12), types = collectionBuyTypes(target)
  const registrationId = collectionCommandRegistration(target, author), markerId = collectionBuyOwnerMarker(target, kioskId)
  const rows = new Map<string, any>(), specs = new Map<string, any>()
  function write(key: string, objectId: string, type: string, codec: any, value: any, owner: any) {
    specs.set(key, { objectId, type, codec, value, owner })
    const contents = codec.serialize(value).toBytes(), tag = TypeTagSerializer.parseFromStr(type)
    if (!('struct' in tag)) throw Error('Struct required')
    const bytes = bcs.Object.serialize({ data: { Move: { type: { Other: tag.struct }, hasPublicTransfer: false, version: '9', contents } },
      owner, previousTransaction: prior, storageRebate: '0' }).toBytes()
    rows.set(objectId, { objectId, version: 9n, digest: collectionCommandHash('Object', bytes), previousTransaction: prior,
      objectType: normalizeStructTag(type), contents: { value: contents }, bcs: { value: bytes },
      owner: owner.Shared ? { kind: 3, version: BigInt(owner.Shared.initialSharedVersion) }
        : owner.AddressOwner ? { kind: 1, address: owner.AddressOwner } : { kind: 2, address: owner.ObjectOwner } })
  }
  function rewrite(key: string, update: (s: any) => void) {
    const s = specs.get(key); update(s); write(key, s.objectId, s.type, s.codec, s.value, s.owner)
  }
  write('registry', target.kioskRegistryId, types.registry, CollectionKioskRegistryBcs,
    { id: target.kioskRegistryId, version: '1' }, { Shared: { initialSharedVersion: '1' } })
  if (existing) {
    write('registration', registrationId, types.registration, CollectionKioskRegistrationFieldBcs,
      { id: registrationId, name: { owner: author }, value: { version: '1', kiosk_id: kioskId, kiosk_cap_id: capId } }, { ObjectOwner: target.kioskRegistryId })
    write('kiosk', kioskId, types.kiosk, SoulPublicKioskBcs,
      { id: kioskId, profits: '123', owner: author, item_count: 0, allow_extensions: true }, { Shared: { initialSharedVersion: '1' } })
    write('cap', capId, types.cap, CollectionPersonalKioskCapBcs,
      { id: capId, cap: { id: id(13), for: kioskId } }, { AddressOwner: author })
    write('marker', markerId, types.ownerMarker, CollectionBuyOwnerMarkerBcs,
      { id: markerId, name: { dummy_field: false }, value: author }, { ObjectOwner: kioskId })
  }
  const read = vi.fn(async ({ requests }: { requests: { objectId: string }[] }) => ({ response: { objects: requests.map(({ objectId }) => ({
    result: rows.has(objectId) ? { oneofKind: 'object', object: structuredClone(rows.get(objectId)) }
      : { oneofKind: 'error', error: { code: 5 } },
  })) } }))
  const client = { core: { getChainIdentifier: vi.fn(async () => ({ chainIdentifier: MAINNET_GENESIS_DIGEST })) }, ledgerService: { batchGetObjects: read } }
  const controller = new AbortController(), params = { client: client as unknown as SuiGrpcClient, target, author, signal: controller.signal }
  return { target, author, kioskId, capId, registrationId, markerId, rows, rewrite, read, client, controller, params,
    run: () => resolveSoulAuthoringKiosk(params) }
}
it('returns NEW only after stable explicit registration absence', async () => {
  const f = fixture(false)
  await expect(f.run()).resolves.toEqual({ kind: 'NEW', kioskId: null, capId: null })
  expect(f.read).toHaveBeenCalledTimes(4)
})
it('accepts an existing empty personal Kiosk with nonzero profits', async () => {
  const f = fixture()
  await expect(f.run()).resolves.toEqual({ kind: 'EXISTING', kioskId: f.kioskId, capId: f.capId })
  expect(f.read).toHaveBeenCalledTimes(10)
})
it.each([
  ['registry', (s: any) => { s.value.version = '2' }],
  ['registration', (s: any) => { s.value.name.owner = id(99) }],
  ['registration', (s: any) => { s.owner = { ObjectOwner: id(99) } }],
  ['kiosk', (s: any) => { s.value.owner = id(99) }],
  ['kiosk', (s: any) => { s.type = `${id(99)}::kiosk::Kiosk` }],
  ['cap', (s: any) => { s.owner = { AddressOwner: id(99) } }],
  ['cap', (s: any) => { s.value.cap = null }],
  ['cap', (s: any) => { s.value.cap.for = id(99) }],
  ['marker', (s: any) => { s.value.value = id(99) }],
  ['marker', (s: any) => { s.value.name.dummy_field = true }],
] as const)('rejects authenticated but mismatching %s', async (key, update) => {
  const f = fixture(); f.rewrite(key, update); await expect(f.run()).rejects.toThrow()
})
it('rejects a missing cap, never falls back to NEW', async () => {
  const f = fixture(); f.rows.delete(f.capId); await expect(f.run()).rejects.toThrow('OBJECT_UNAVAILABLE')
})
it('rejects full BCS digest tampering', async () => {
  const f = fixture(); f.rows.get(f.capId).bcs.value[40] ^= 1; await expect(f.run()).rejects.toThrow()
})
it('does not convert transport failure into registration absence', async () => {
  const f = fixture(false), original = f.read.getMockImplementation()!
  f.read.mockImplementation(async input => {
    if (input.requests[0].objectId === f.registrationId) throw Error('Transport unavailable')
    return original(input)
  })
  await expect(f.run()).rejects.toThrow('Transport unavailable')
})
it('rejects a changed readset on the second read', async () => {
  const f = fixture(), original = f.read.getMockImplementation()!; let reads = 0
  f.read.mockImplementation(async input => {
    if (++reads === 6) f.rewrite('kiosk', s => { s.value.item_count = 1 })
    return original(input)
  })
  await expect(f.run()).rejects.toThrow('READSET_CHANGED')
})
it('rejects chain mismatch and an already aborted caller', async () => {
  const f = fixture(); f.client.core.getChainIdentifier.mockResolvedValue({ chainIdentifier: prior })
  await expect(f.run()).rejects.toThrow('WRONG_CHAIN')
  f.controller.abort(); f.read.mockClear(); await expect(f.run()).rejects.toThrow(); expect(f.read).not.toHaveBeenCalled()
})
