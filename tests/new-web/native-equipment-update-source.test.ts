import { expect, it, vi } from 'vitest'
import { readBrowserNativeEquipment, parseBrowserEquipmentQuery } from '../../web/lib/animacraft/browser-native-equipment'
import { EquipmentBaseRegistryBcs, EquipmentDefinitionsBcs } from '../../web/lib/animacraft/native-equipment-source-bcs'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
function fixture() {
  const f = nativeEquipmentSourceFixture()
  const read = () => readBrowserNativeEquipment({ soulId: id(12), stateId: id(14), query: new URLSearchParams('update=1') },
    { target: () => f.target, client: () => f.client })
  return { ...f, read }
}
it('reads exact final-validation identities without Maker lifecycle, access, candidate pages or Seal dependencies', async () => {
  const f = fixture()
  for (const objectId of [id(10), id(20), id(83), id(87), f.indexId, f.styleId]) f.objects.delete(objectId)
  const snapshot = await f.read()
  expect(snapshot.updateSource).toEqual({ definitionRegistryId: id(81), baseRegistryId: id(85) })
  expect(snapshot.source).toBeNull()
  expect(snapshot.inventory).toBeNull()
  expect(snapshot.equipment?.loadout.selection_count).toBe('1')
})
it.each(['definitions', 'base'] as const)('rejects missing %s instead of guessing a registry', async row => {
  const f = fixture(); f.objects.delete(id(row === 'definitions' ? 81 : 85))
  await expect(f.read()).rejects.toThrow()
})
it.each(['id', 'version', 'root', 'root-version', 'commitment', 'sealed', 'base-id'] as const)
('rejects final-validation definitions %s mismatch', async problem => {
  const f = fixture()
  f.set(id(81), EquipmentDefinitionsBcs, row => {
    if (problem === 'id') row.id = id(999)
    if (problem === 'version') row.version = '7'
    if (problem === 'root') row.root_id = id(999)
    if (problem === 'root-version') row.root_version = '99'
    if (problem === 'commitment') row.root_content_commitment = Array(32).fill(9)
    if (problem === 'sealed') row.sealed = false
    if (problem === 'base-id') row.base_registry_id = id(999)
  })
  await expect(f.read()).rejects.toThrow()
})
it.each(['id', 'version', 'root', 'root-version', 'commitment', 'sealed', 'sealed-commitment'] as const)
('rejects final-validation Base %s mismatch', async problem => {
  const f = fixture()
  f.set(id(85), EquipmentBaseRegistryBcs, row => {
    if (problem === 'id') row.id = id(999)
    if (problem === 'version') row.version = '7'
    if (problem === 'root') row.root_id = id(999)
    if (problem === 'root-version') row.maker_version = '99'
    if (problem === 'commitment') row.root_content_commitment = Array(32).fill(9)
    if (problem === 'sealed') row.sealed = false
    if (problem === 'sealed-commitment') row.sealed_commitments = null
  })
  await expect(f.read()).rejects.toThrow()
})
it.each([81, 85])('rechecks source %s against drift before returning the update snapshot', async objectId => {
  const f = fixture(), get = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  vi.spyOn(f.client.ledgerService, 'getObject').mockImplementation((async (request: Parameters<typeof get>[0]) => {
    if (request.objectId === id(objectId) && request.readMask?.paths.length === 3) f.objects.get(id(objectId)).version++
    return get(request)
  }) as unknown as typeof get)
  await expect(f.read()).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_CHANGED' })
})
it.each(['update=0', 'update=true', 'update=1&update=1'])('rejects malformed update flag %s', query => {
  expect(() => parseBrowserEquipmentQuery(new URLSearchParams(query))).toThrow()
})
