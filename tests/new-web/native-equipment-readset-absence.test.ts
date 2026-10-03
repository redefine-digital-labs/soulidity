import { expect, it } from 'vitest'
import { EquipmentReadSet } from '../../web/lib/animacraft/native-equipment'
import { nativeEquipmentFixture } from './fixtures/native-equipment'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
it.each([false, true])('detects an absent authority/entitlement appearing before final verification (cache=%s)', async cache => {
  const f = nativeEquipmentFixture(), reads = new EquipmentReadSet(f.client, cache)
  expect(await reads.optional(id(990), 'u8', 2, id(991))).toBeNull()
  f.objects.set(id(990), { objectId: id(990), version: 1n, digest: f.target.outputCallableDigest,
    objectType: 'u8', owner: { kind: 2, address: id(991) }, contents: { value: new Uint8Array([0]) } })
  await expect(reads.verify()).rejects.toThrow('changed')
})

it('does not reinterpret absence-recheck RPC errors as still missing', async () => {
  const f = nativeEquipmentFixture(), reads = new EquipmentReadSet(f.client, true)
  expect(await reads.optional(id(990), 'u8', 2, id(991))).toBeNull()
  f.client.ledgerService.batchGetObjects = (async () => ({ response: { objects: [
    { result: { oneofKind: 'error', error: { code: 14, message: 'unavailable' } } },
  ] } })) as never
  await expect(reads.verify()).rejects.toThrow()
})

it('accepts continued exact NOT_FOUND without listing or unbounded polling', async () => {
  const f = nativeEquipmentFixture(), reads = new EquipmentReadSet(f.client, true)
  expect(await reads.optional(id(990), 'u8', 2, id(991))).toBeNull()
  await expect(reads.verify()).resolves.toBeUndefined()
})
