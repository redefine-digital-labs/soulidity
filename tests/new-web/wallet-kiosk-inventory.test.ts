import { expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { createWalletKioskInventory } from '../../packages/soulidity-sdk/src/wallet-kiosk-inventory'
import { deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '../../packages/soulidity-sdk/src/kiosk-item-custody'
import { SoulPublicKioskBcs } from '../../packages/soulidity-sdk/src/soul-public-listing'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = toBase58(new Uint8Array(32).fill(1)), A = bcs.Address, U = bcs.u64()
function fixture() {
  const deployment = { originalPackageId: id(1), chainIdentifier: '01010101', kioskRegistryId: id(2) }, owner = id(3)
  const keyType = `${id(1)}::market::PersonalKioskOwnerKey`
  const registrationId = deriveDynamicFieldID(id(2), keyType, A.serialize(owner).toBytes())
  const kiosk = { id: id(4), profits: '0', owner, item_count: 1, allow_extensions: false }
  const rows = new Map<string, any>()
  const put = (objectId: string, objectType: string, bytes: Uint8Array, custody: any = { kind: 3, version: 1n }) =>
    rows.set(objectId, { objectId, objectType: normalizeStructTag(objectType), version: 1n, digest, owner: custody, contents: { value: bytes } })
  put(id(2), `${id(1)}::market::KioskRegistry`, bcs.struct('Registry', { id: A, version: U }).serialize({ id: id(2), version: '1' }).toBytes())
  put(registrationId, `0x2::dynamic_field::Field<${keyType},${id(1)}::market::PersonalKioskRegistration>`,
    bcs.struct('Field', { id: A, name: A, value: bcs.struct('Registration', { version: U, kiosk_id: A, kiosk_cap_id: A }) })
      .serialize({ id: registrationId, name: owner, value: { version: '1', kiosk_id: id(4), kiosk_cap_id: id(5) } }).toBytes(), { kind: 2, address: id(2) })
  const putKiosk = () => put(kiosk.id, '0x2::kiosk::Kiosk', SoulPublicKioskBcs.serialize(kiosk).toBytes())
  const candidate = (itemId: string, assetType = `${id(1)}::soul::Soul`) => {
    const fieldId = deriveKioskItemFieldId(kiosk.id, itemId)
    put(fieldId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs.serialize({ id: fieldId, name: { name: { id: itemId } }, value: itemId }).toBytes(), { kind: 2, address: kiosk.id })
    put(itemId, assetType, A.serialize(itemId).toBytes(), { kind: 2, address: fieldId })
    return { parent: kiosk.id, fieldId, name: { name: '0x2::kiosk::Item', value: A.serialize(itemId).toBytes() },
      kind: 2, childId: itemId, valueType: assetType }
  }
  const item = candidate(id(6)), pages: any[][] = [[item]]
  putKiosk()
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://grpc.example.com' })
  const chain = vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: digest })
  const batch = vi.spyOn(client.ledgerService, 'batchGetObjects').mockImplementation((async ({ requests }: any) => ({ response: {
    objects: requests.map(({ objectId }: any) => ({ result: rows.has(objectId) ? { oneofKind: 'object', object: structuredClone(rows.get(objectId)) }
      : { oneofKind: 'error', error: { code: 5 } } })) } })) as any)
  const list = vi.spyOn(client.stateService, 'listDynamicFields').mockImplementation((async (request: any) => {
    const index = request.pageToken?.[0] ?? 0
    return { response: { dynamicFields: structuredClone(pages[index] ?? []), ...(index + 1 < pages.length ? { nextPageToken: new Uint8Array([index + 1]) } : {}) } }
  }) as any)
  const owned = vi.spyOn(client.stateService, 'listOwnedObjects').mockRejectedValue(new Error('No direct wallet-owned Soul scan'))
  const create = (limits: Partial<Parameters<typeof createWalletKioskInventory>[0]> = {}) => createWalletKioskInventory({ client, deployment, owner, ...limits })
  return { deployment, owner, kiosk, registrationId, rows, putKiosk, candidate, item, pages, client, chain, batch, list, owned, create }
}
it('reads registered Kiosk items with the official unwrapped gRPC name and exact wrapper/child proof', async () => {
  const f = fixture()
  f.pages[0].push({ parent: f.kiosk.id, fieldId: id(20), kind: 1,
    name: { name: '0x2::kiosk::Lock', value: A.serialize(id(6)).toBytes() }, valueType: 'bool' })
  const result = await f.create().next()
  expect(result).toMatchObject({ owner: f.owner, kioskId: f.kiosk.id, registeredCapId: id(5), status: 'COMPLETE',
    expectedItemCount: 1, scannedFields: 2, pages: 1, notAuthorization: true })
  expect(result.items).toEqual([{ itemId: id(6), fieldId: f.item.fieldId, type: `${id(1)}::soul::Soul`, version: '1', digest }])
  expect(Object.isFrozen(result.items[0])).toBe(true); expect(f.owned).not.toHaveBeenCalled()
  expect(f.list.mock.calls[0][0].readMask?.paths).toContain('child_id')
  expect(f.batch.mock.calls.every(([, options]) => options?.abort instanceof AbortSignal)).toBe(true)
})
it('counts other Kiosk asset types, not only Souls, across all pages', async () => {
  const f = fixture(); f.kiosk.item_count = 2; f.putKiosk()
  f.pages.push([f.candidate(id(7), `${id(8)}::other::Asset`)])
  const scanner = f.create()
  expect(await scanner.next()).toMatchObject({ status: 'PARTIAL', expectedItemCount: 2, pages: 1 })
  const result = await scanner.next(); expect(result.status).toBe('COMPLETE'); expect(result.items).toHaveLength(2)
  await expect(scanner.next()).rejects.toThrow('SCAN_ENDED')
})
it('requires stable proven absence of a wallet registration and never guesses from RPC errors', async () => {
  const f = fixture(); f.rows.delete(f.registrationId)
  expect(await f.create().next()).toMatchObject({ status: 'COMPLETE', kioskId: null, items: [] })
  expect(f.list).not.toHaveBeenCalled()
  f.batch.mockRejectedValueOnce(new Error('offline'))
  await expect(f.create().next()).rejects.toThrow('offline')
})
it.each(['field-missing', 'field-parent', 'field-uid', 'field-key', 'field-value', 'field-type', 'child-missing', 'child-parent',
  'child-type', 'child-uid', 'digest', 'version', 'candidate-parent', 'candidate-id', 'candidate-child', 'candidate-kind', 'count', 'duplicate'] as const)(
  'rejects inconsistent custody or discovery: %s', async problem => {
    const f = fixture(), field = f.rows.get(f.item.fieldId), child = f.rows.get(id(6))
    if (problem === 'field-missing') f.rows.delete(f.item.fieldId)
    if (problem === 'field-parent') field.owner.address = id(99)
    if (problem.startsWith('field-') && ['field-uid', 'field-key', 'field-value'].includes(problem)) {
      const value = KioskItemFieldBcs.parse(field.contents.value)
      if (problem === 'field-uid') value.id = id(99)
      if (problem === 'field-key') value.name.name.id = id(99)
      if (problem === 'field-value') value.value = id(99)
      field.contents.value = KioskItemFieldBcs.serialize(value).toBytes()
    }
    if (problem === 'field-type') field.objectType = `${id(1)}::soul::Soul`
    if (problem === 'child-missing') f.rows.delete(id(6))
    if (problem === 'child-parent') child.owner.address = f.kiosk.id
    if (problem === 'child-type') child.objectType = `${id(1)}::soul::SoulState`
    if (problem === 'child-uid') child.contents.value = A.serialize(id(99)).toBytes()
    if (problem === 'digest') child.digest = 'invalid'
    if (problem === 'version') child.version = 0n
    if (problem === 'candidate-parent') f.item.parent = id(99)
    if (problem === 'candidate-id') f.item.fieldId = id(99)
    if (problem === 'candidate-child') f.item.childId = id(99)
    if (problem === 'candidate-kind') f.item.kind = 1
    if (problem === 'count') { f.kiosk.item_count = 2; f.putKiosk() }
    if (problem === 'duplicate') f.pages[0].push(f.item)
    await expect(f.create().next()).rejects.toThrow()
  })
it('retains even a terminal candidate page for retry when its raw proof fails', async () => {
  const f = fixture(), saved = f.rows.get(id(6)), scanner = f.create()
  f.rows.delete(id(6)); await expect(scanner.next()).rejects.toThrow('OBJECT_UNAVAILABLE')
  f.rows.set(id(6), saved)
  expect(await scanner.next()).toMatchObject({ status: 'COMPLETE', pages: 1 })
  expect(f.list).toHaveBeenCalledTimes(1)
})
it('does not silently restart or merge membership across a transfer between pages', async () => {
  const f = fixture(); f.kiosk.item_count = 2; f.putKiosk(); f.pages.push([f.candidate(id(7))])
  const scanner = f.create(); await scanner.next(); f.rows.get(f.kiosk.id).version = 2n
  await expect(scanner.next()).rejects.toThrow('MEMBERSHIP_CHANGED_RESTART')
  expect(f.list).toHaveBeenCalledTimes(1)
})
it.each([{ maxPages: 1 }, { maxItems: 1 }, { maxFields: 1 }])('reports a bounded partial limit, not an empty completed inventory: %o', async limits => {
  const f = fixture(); f.kiosk.item_count = 2; f.putKiosk(); f.pages.push([f.candidate(id(7))])
  const scanner = f.create(limits), first = await scanner.next()
  const result = first.status === 'PARTIAL' ? await scanner.next() : first
  expect(result).toMatchObject({ status: 'LIMIT_REACHED', expectedItemCount: 2 }); expect(result.items).toHaveLength(1)
})
it('rejects a repeating cursor without committing that page', async () => {
  const f = fixture(); f.pages.push([]); const scanner = f.create(); await scanner.next()
  f.list.mockResolvedValueOnce({ response: { dynamicFields: [], nextPageToken: new Uint8Array([1]) } } as any)
  await expect(scanner.next()).rejects.toThrow('CURSOR_NOT_ADVANCING')
})
it('pins the chain and handles abort before any I/O', async () => {
  const f = fixture(); f.deployment.chainIdentifier = 'ffffffff'
  await expect(f.create().next()).rejects.toThrow('WRONG_CHAIN'); expect(f.batch).not.toHaveBeenCalled()
  const controller = new AbortController(); controller.abort(new Error('wallet changed'))
  await expect(f.create().next({ signal: controller.signal })).rejects.toThrow('wallet changed')
})
it.each(['bool', 'vector<u8>', '0x2::bad-module::Asset', '0x2::module::123', '0x2::module::_',
  '0x2::module::Asset<vector<0x2::bad-module::Asset>>', '0x2::module::Asset<u8>suffix'])(
  'rejects malformed or non-object Kiosk item types: %s', async value => {
    const f = fixture(); f.item.valueType = value; f.rows.get(id(6)).objectType = value
    await expect(f.create().next()).rejects.toThrow(/INVALID/)
  })
it('normalizes nested generic addresses while accepting primitive type parameters', async () => {
  const f = fixture(), value = '0x2::example::_Asset<vector<0x3::other::Value<u8>>,bool>'
  f.item.valueType = value; f.rows.get(id(6)).objectType = normalizeStructTag(value)
  const result = await f.create().next()
  expect(result.status).toBe('COMPLETE'); expect(result.items[0].type).toBe(normalizeStructTag(value))
})
