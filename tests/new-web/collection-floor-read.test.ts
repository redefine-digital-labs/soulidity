import { expect, it } from 'vitest'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { CollectionFloorKeyBcs as K, CollectionFloorFieldBcs as F, CollectionFloorParentBcs as P,
  readCollectionFloorPolicy } from '../../packages/soulidity-sdk/src/collection-floor-read'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
function fixture(value: string | null = '99999999999999999999') {
  const pkg = id(1), parent = id(2), keyType = `${pkg}::collection::FloorPolicyKeyV1`
  const field = deriveDynamicFieldID(parent, keyType, K.serialize({ version: 1 }).toBytes())
  const digest = toBase58(new Uint8Array(32).fill(1))
  const parentValue = { id: parent, version: '1', creator: id(3), extra_royalty_bps: 250, tradeable: true,
    current_holder: id(3), current_holder_kiosk_id: id(4), right_id: id(5), max_supply: null, current_supply: '0' }
  const fieldValue = { id: field, name: { version: 1 }, value }
  const rows = new Map<string, any>([
    [parent, { objectId: parent, objectType: normalizeStructTag(`${pkg}::collection::SoulCollection`), version: 1n,
      digest, owner: { kind: 3, version: 1n }, contents: { value: P.serialize(parentValue).toBytes() } }],
    [field, { objectId: field, objectType: normalizeStructTag(`0x2::dynamic_field::Field<${keyType},0x1::option::Option<u128>>`),
      version: 1n, digest, owner: { kind: 2, address: parent }, contents: { value: F.serialize(fieldValue).toBytes() } }],
  ])
  const args = { collectionId: parent, deployment: { originalPackageId: pkg, chainIdentifier: '00000000' }, client: {
    core: { getChainIdentifier: async () => ({ chainIdentifier: toBase58(new Uint8Array(32)) }) },
    ledgerService: { getObject: async ({ objectId }: any) => ({ response: { object: structuredClone(rows.get(objectId)) } }) },
  } as any }
  return { args, rows, field, parent, parentValue, fieldValue }
}
it.each([null, '0', '18446744073709551616', '99999999999999999999'])('raw reader preserves %s', async value => {
  expect((await readCollectionFloorPolicy(fixture(value).args)).floorPriceAtomic).toBe(value)
})
it.each(['missing', 'owner', 'type', 'id', 'key', 'uid', 'trailing', 'limit', 'parent', 'parent-owner', 'parent-version', 'max'])('rejects %s instead of inventing None', async fault => {
  const f = fixture(), row = f.rows.get(f.field)
  if (fault === 'missing') f.rows.delete(f.field)
  if (fault === 'owner') row.owner.address = id(9)
  if (fault === 'type') row.objectType = row.objectType.replace('u128', 'u64')
  if (fault === 'id') row.objectId = id(9)
  if (fault === 'key') row.contents.value = F.serialize({ ...f.fieldValue, name: { version: 2 } }).toBytes()
  if (fault === 'uid') row.contents.value = F.serialize({ ...f.fieldValue, id: id(9) }).toBytes()
  if (fault === 'trailing') row.contents.value = new Uint8Array([...row.contents.value, 0])
  if (fault === 'limit') row.contents.value = new Uint8Array(1025)
  if (fault === 'parent') f.rows.get(f.parent).contents.value = P.serialize({ ...f.parentValue, id: id(9) }).toBytes()
  if (fault === 'parent-owner') f.rows.get(f.parent).owner.kind = 2
  if (fault === 'parent-version') f.rows.get(f.parent).contents.value = P.serialize({ ...f.parentValue, version: '2' }).toBytes()
  if (fault === 'max') row.contents.value = F.serialize({ ...f.fieldValue, value: '100000000000000000000' }).toBytes()
  await expect(readCollectionFloorPolicy(f.args)).rejects.toThrow()
})
it('rejects wrong chain, mutation during reads and cancellation', async () => {
  const f = fixture(); f.args.deployment.chainIdentifier = '01000000'
  await expect(readCollectionFloorPolicy(f.args)).rejects.toThrow('WRONG_CHAIN')
  const g = fixture(); const get = g.args.client.ledgerService.getObject
  let calls = 0
  g.args.client.ledgerService.getObject = async (a: any) => { if (++calls === 3) g.rows.get(g.parent).version = 2n; return get(a) }
  await expect(readCollectionFloorPolicy(g.args)).rejects.toThrow('CHANGED_RETRY')
  const h = fixture(), controller = new AbortController(); controller.abort()
  await expect(readCollectionFloorPolicy({ ...h.args, signal: controller.signal })).rejects.toThrow()
})
it('does not publish a snapshot cancelled during the final read continuation', async () => {
  const f = fixture(), controller = new AbortController(), get = f.args.client.ledgerService.getObject
  let calls = 0
  f.args.client.ledgerService.getObject = async (args: any) => {
    const answer = await get(args)
    if (++calls === 4) queueMicrotask(() => queueMicrotask(() => controller.abort()))
    return answer
  }
  await expect(readCollectionFloorPolicy({ ...f.args, signal: controller.signal })).rejects.toThrow()
})
