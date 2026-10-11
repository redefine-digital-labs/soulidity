import { expect, it } from 'vitest'
import { EquipmentReadSet } from '../../web/lib/animacraft/native-equipment'
import { NativePackDefinitionsBcs, NativePackDefinitionsKeyBcs, NativePackDefinitionsFieldBcs,
  nativePackDefinitionsCommitment, readNativePackDefinitions, findNativePackDefinitions, nativePackOwnedDefinition,
  type NativePackDefinitions } from '../../web/lib/animacraft/native-pack-definitions'
import { nativeEquipmentPackFixture, packId as id } from './fixtures/native-equipment-pack'

function fixture() {
  const f = nativeEquipmentPackFixture()
  const value: NativePackDefinitions = { version: '8', release_id: f.releaseId,
    release_content_commitment: f.release.content_commitment, commitment: [], rows: {
      semantic_pack_id: 'winter',
      tracks: [{ sequence: '0', key: 'front', label: 'Owned front', render_order: '5', locked: false }],
      colors: [{ sequence: '1', key: 'pack-tint', label: 'Owned tint', default_swatch_key: 'snow',
        swatches: [{ key: 'snow', label: 'Owned snow', rgba: 0xff0000ff,
          stops: [{ offset_ppm: '0', rgba: 0xff0000ff }, { offset_ppm: '1000000', rgba: 0x0000ffff }] }] }],
      parts: [{ sequence: '2', key: 'body', label: 'Owned body', kind: 1, render_order: '3', menu_order: '2',
        visible: true, required: false, slot_mode: 1, capacity: '2', track_keys: ['front'],
        visibility_tokens: [], visibility_commitment: Array(32).fill(1), payload_commitment: Array(32).fill(2) }],
      rules: [{ sequence: '3', key: 'rule', kind: 1,
        trigger: { source: 2, source_key: 'winter', part_key: 'body', item_key: null, style_key: null },
        target_mode: 0, targets: [{ source: 1, source_key: null, part_key: 'body', item_key: 'hat', style_key: 'red' }],
        payload_commitment: Array(32).fill(3) }],
      visibility: [{ subject: 1, definition_source: 2, part_key: 'body', item_key: 'pack-hat', style_key: null,
        visibility_tokens: [{ opcode: 1, selector: null, arity: 0 }], visibility_commitment: Array(32).fill(4) }],
    } }
  value.commitment = nativePackDefinitionsCommitment(value)
  const fieldId = f.field(f.releaseId, f.runtimeType('PackDefinitionsKeyV8'), NativePackDefinitionsKeyBcs,
    { dummy_field: false }, f.runtimeType('PackDefinitionsV8'), NativePackDefinitionsBcs, value)
  const reads = new EquipmentReadSet(f.client)
  const read = () => readNativePackDefinitions(reads, f.release, f.runtimeType)
  const mutate = (change: (row: ReturnType<typeof NativePackDefinitionsFieldBcs.parse>) => void) =>
    f.set(fieldId, NativePackDefinitionsFieldBcs, change)
  return { ...f, fieldId, value, reads, read, mutate }
}

it('reads complete finalized definition rows through the exact Release-owned field', async () => {
  const f = fixture()
  expect([...NativePackDefinitionsKeyBcs.serialize({ dummy_field: false }).toBytes()]).toEqual([0])
  expect(await f.read()).toEqual(f.value)
})
it('discovers finalized definitions or exact absence without treating damaged bytes as absence', async () => {
  const f = fixture()
  expect(await findNativePackDefinitions(f.reads, f.release, f.runtimeType)).toEqual(f.value)
  f.objects.get(f.fieldId).contents.value = new Uint8Array([0])
  await expect(findNativePackDefinitions(f.reads, f.release, f.runtimeType)).rejects.toThrow()
  f.objects.delete(f.fieldId)
  await expect(findNativePackDefinitions(f.reads, f.release, f.runtimeType)).rejects.toThrow('changed to absent')
  // A new lookup can certify absence, but a snapshot that already saw the
  // definition may not silently reinterpret deletion as a simple Pack.
  expect(await findNativePackDefinitions(new EquipmentReadSet(f.client), f.release, f.runtimeType)).toBeNull()
})
it('propagates lookup failure rather than inventing a simple Pack', async () => {
  const f = fixture()
  f.client.ledgerService.batchGetObjects = async () => { throw new Error('offline') }
  await expect(findNativePackDefinitions(f.reads, f.release, f.runtimeType)).rejects.toThrow('offline')
})
it('matches the independent Animacraft publisher wire and commitment vector', () => {
  // Generated with maker-v8-pack-definition-wire.js, not this reader's codecs.
  const wire = '080000000000000000000000000000000000000000000000000000000000000000000000000000ca2008080808080808080808080808080808080808080808080808080808080808080677696e7465720100000000000000000566726f6e740b4f776e65642066726f6e740500000000000000000000000020ffc16b4300f04253d720975cc3366f0d90d017a851434e5b5ff5924f2cd8b40a'
  const value = NativePackDefinitionsBcs.parse(Buffer.from(wire, 'hex'))
  expect(value.release_id).toBe(id(202))
  expect(value.rows).toEqual({ semantic_pack_id: 'winter', tracks: [{ sequence: '0', key: 'front',
    label: 'Owned front', render_order: '5', locked: false }], colors: [], parts: [], rules: [], visibility: [] })
  expect(Buffer.from(NativePackDefinitionsBcs.serialize(value).toBytes()).toString('hex')).toBe(wire)
  expect(Buffer.from(nativePackDefinitionsCommitment(value)).toString('hex'))
    .toBe('ffc16b4300f04253d720975cc3366f0d90d017a851434e5b5ff5924f2cd8b40a')
})
it.each(['release', 'content', 'semantic'])('rejects self-consistent foreign %s bindings', async problem => {
  const f = fixture()
  f.mutate(row => {
    if (problem === 'release') row.value.release_id = id(999)
    if (problem === 'content') row.value.release_content_commitment[0] ^= 1
    if (problem === 'semantic') row.value.rows.semantic_pack_id = 'foreign'
    row.value.commitment = nativePackDefinitionsCommitment(row.value)
  })
  await expect(f.read()).rejects.toThrow('Release binding mismatch')
})
it.each(['parts', 'tracks', 'colors'] as const)('resolves colliding %s only inside the certified Pack', async category => {
  const f = fixture(); const definitions = await f.read(); const expected = f.value.rows[category][0]
  expect(nativePackOwnedDefinition(definitions, category, expected.key)).toEqual(expected)
  expect(() => nativePackOwnedDefinition(definitions, category, 'base-only')).toThrow('missing/ambiguous')
  definitions.rows[category].push(expected as never)
  expect(() => nativePackOwnedDefinition(definitions, category, expected.key)).toThrow('missing/ambiguous')
})
it.each(['uid', 'key', 'version', 'release', 'content', 'semantic', 'hash', 'track', 'color', 'part', 'rule', 'visibility'])
('rejects altered %s evidence', async problem => {
  const f = fixture()
  f.mutate(row => {
    if (problem === 'uid') row.id = id(999)
    if (problem === 'key') row.name.dummy_field = true
    if (problem === 'version') row.value.version = '7'
    if (problem === 'release') row.value.release_id = id(999)
    if (problem === 'content') row.value.release_content_commitment[0] ^= 1
    if (problem === 'semantic') row.value.rows.semantic_pack_id = 'foreign'
    if (problem === 'hash') row.value.commitment[0] ^= 1
    if (problem === 'track') row.value.rows.tracks[0].render_order = '99'
    if (problem === 'color') row.value.rows.colors[0].swatches[0].stops[0].rgba = 1
    if (problem === 'part') row.value.rows.parts[0].capacity = '3'
    if (problem === 'rule') row.value.rows.rules[0].targets[0].part_key = 'foreign'
    if (problem === 'visibility') row.value.rows.visibility[0].definition_source = 1
  })
  await expect(f.read()).rejects.toThrow(/Pack definitions/)
})
it.each(['owner', 'kind', 'type', 'missing', 'trailing', 'oversized'])('rejects %s field evidence without fallback', async problem => {
  const f = fixture(); const object = f.objects.get(f.fieldId)
  if (problem === 'owner') object.owner.address = id(999)
  if (problem === 'kind') object.owner.kind = 3
  if (problem === 'type') object.objectType = object.objectType.replace('PackDefinitionsV8', 'PackDefinitionsDraftV8')
  if (problem === 'missing') f.objects.delete(f.fieldId)
  if (problem === 'trailing') object.contents.value = new Uint8Array([...object.contents.value, 0])
  if (problem === 'oversized') object.contents.value = new Uint8Array(2 * 1024 * 1024 + 1)
  await expect(f.read()).rejects.toThrow()
})
it('retains optimistic read-set version checks instead of introducing a separate unchecked cache', async () => {
  const f = fixture(); await f.read()
  f.objects.get(f.fieldId).version += 1n
  await expect(f.read()).rejects.toThrow('Object changed during read')
})
it('includes finalized definitions in the final snapshot consistency check', async () => {
  const f = fixture(); await f.read(); await f.reads.verify()
  f.objects.get(f.fieldId).digest = 'changed-after-dependent-reads'
  await expect(f.reads.verify()).rejects.toThrow()
})
