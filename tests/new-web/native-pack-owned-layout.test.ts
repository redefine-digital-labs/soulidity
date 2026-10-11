import { bcs } from '@mysten/sui/bcs'
import { expect, it } from 'vitest'
import { nativeRenderSourceFixture } from './fixtures/native-render-source'
import { EquipmentPackStyleBcs, EquipmentPackStyleKeyBcs } from '../../web/lib/animacraft/native-equipment-pack'
import { NativePackDefinitionsFieldBcs, nativePackDefinitionsCommitment } from '../../web/lib/animacraft/native-pack-definitions'
import { nativeVisibilityCommitment } from '../../web/lib/animacraft/native-visibility'
const StyleField = bcs.struct('Field', { id: bcs.Address, name: EquipmentPackStyleKeyBcs, value: EquipmentPackStyleBcs })
function fixture(part = true, track = true) {
  const f = nativeRenderSourceFixture(); const { definitionId } = f.addOwnedColor()
  f.set(f.packStyleId, StyleField, row => {
    row.value.definition_sources.part = part ? 2 : 1; row.value.definition_sources.track = track ? 2 : 1
  })
  const update = (change: (v: ReturnType<typeof NativePackDefinitionsFieldBcs.parse>['value']) => void) =>
    f.set(definitionId, NativePackDefinitionsFieldBcs, row => { change(row.value); row.value.commitment = nativePackDefinitionsCommitment(row.value) })
  update(value => {
    value.rows.tracks = [{ sequence: '0', key: 'front', label: 'Owned front', render_order: '23', locked: false }]
    value.rows.parts = [{ sequence: '2', key: 'body', label: 'Owned body', kind: 0, render_order: '0', menu_order: '0',
      visible: true, required: false, slot_mode: 1, capacity: '3', track_keys: ['front'], visibility_tokens: [],
      visibility_commitment: nativeVisibilityCommitment({ level: 'PART', partKey: 'body', itemKey: null, styleKey: null,
        definitionSource: 2, definitionSourceKey: 'winter' }, []), payload_commitment: Array(32).fill(1) }]
  })
  return { ...f, update, definitionId, read: () => f.readRender([{ ...f.packSelection, swatch_key: 'violet' }]) }
}
it.each([[true, true], [true, false], [false, true]])('resolves independent owned Part=%s Track=%s without Base fallback', async (part, track) => {
  const f = fixture(part, track)
  if (part) f.objects.delete(f.partId)
  if (track) f.objects.delete(f.trackId)
  const source = await f.read()
  expect(source.layers[0]).toMatchObject({ trackOrder: track ? 23 : 0, trackSource: track ? 2 : 1, violations: [] })
  expect(f.requests.some(row => part && row.objectId === f.partId || track && row.objectId === f.trackId)).toBe(false)
})
it.each(['parts', 'tracks'] as const)('rejects missing owned %s even with matching Base keys', async category => {
  const f = fixture(); f.update(value => { value.rows[category] = [] })
  await expect(f.read()).rejects.toThrow('Pack-owned definition missing/ambiguous')
})
it('verifies and evaluates the owned Part visibility namespace instead of Base conditions', async () => {
  const f = fixture()
  f.update(value => {
    const part = value.rows.parts[0]
    part.visibility_tokens = [{ opcode: 0, arity: 0, selector: {
      source: 1, source_key: null, part_key: 'body', item_key: 'hat', style_key: 'red',
    } }]
    part.visibility_commitment = nativeVisibilityCommitment({ level: 'PART', partKey: 'body', itemKey: null, styleKey: null,
      definitionSource: 2, definitionSourceKey: 'winter' }, part.visibility_tokens)
  })
  expect((await f.read()).visibility.violations).toEqual([{ selectionIndex: 0, levels: ['PART'] }])
  f.update(value => { value.rows.parts[0].visibility_commitment = nativeVisibilityCommitment({
    level: 'PART', partKey: 'body', itemKey: null, styleKey: null,
  }, value.rows.parts[0].visibility_tokens) })
  await expect(f.read()).rejects.toThrow('Visibility subject commitment mismatch')
})
it('exposes verified owned layout inventory without silently adding persistent slots', async () => {
  const f = fixture()
  const snapshot = await f.readPack()
  expect(snapshot.source?.pack?.selected?.styles[0].definition_sources).toEqual({ part: 2, track: 2, color: 2 })
  expect(snapshot.source?.pack?.selected?.definitionCommitment).toHaveLength(32)
  expect(snapshot.source?.slots).toHaveLength(1)
})
it('recognizes this Pack own selection as local BASE for its authored condition', async () => {
  const f = fixture()
  f.update(value => {
    const part = value.rows.parts[0]
    part.visibility_tokens = [{ opcode: 0, arity: 0, selector: {
      source: 1, source_key: null, part_key: 'body', item_key: 'pack-hat', style_key: 'snow',
    } }]
    part.visibility_commitment = nativeVisibilityCommitment({ level: 'PART', partKey: 'body', itemKey: null, styleKey: null,
      definitionSource: 2, definitionSourceKey: 'winter' }, part.visibility_tokens)
  })
  expect((await f.read()).visibility).toEqual({ valid: true, violations: [] })
})
it('does not satisfy an owned Part condition from a same-named Base Part selection', async () => {
  const f = fixture()
  f.update(value => {
    const part = value.rows.parts[0]
    part.visibility_tokens = [{ opcode: 0, arity: 0, selector: {
      source: 0, source_key: null, part_key: 'body', item_key: 'hat', style_key: 'red',
    } }]
    part.visibility_commitment = nativeVisibilityCommitment({ level: 'PART', partKey: 'body', itemKey: null, styleKey: null,
      definitionSource: 2, definitionSourceKey: 'winter' }, part.visibility_tokens)
  })
  const source = await f.readRender([f.baseSelection, { ...f.packSelection, selection_index: '1', swatch_key: 'violet' }])
  expect(source.visibility.violations).toEqual([{ selectionIndex: 1, levels: ['PART'] }])
})
it.each([0, 2])('keeps Root condition source=%i out of same-named owned Part slots', async sourceClass => {
  const f = fixture()
  f.setVisibility('STYLE', [{ opcode: 0, arity: 0, selector: {
    source: sourceClass, source_key: sourceClass === 2 ? 'winter' : null,
    part_key: 'body', item_key: 'pack-hat', style_key: 'snow',
  } }])
  const source = await f.readRender([f.baseSelection, { ...f.packSelection, selection_index: '1', swatch_key: 'violet' }])
  expect(source.visibility.violations).toEqual([{ selectionIndex: 0, levels: ['STYLE'] }])
})
it.each([1, 2])('evaluates authored Pack subject=%i with local BASE context', async subject => {
  const f = fixture()
  f.update(value => {
    const row = value.rows.visibility.find(row => row.subject === subject)!
    row.definition_source = 2
    row.visibility_tokens = [{ opcode: 0, arity: 0, selector: {
      source: 1, source_key: null, part_key: 'body', item_key: 'pack-hat', style_key: 'snow',
    } }]
    row.visibility_commitment = nativeVisibilityCommitment({ level: subject === 1 ? 'ITEM' : 'STYLE',
      partKey: 'body', itemKey: 'pack-hat', styleKey: subject === 1 ? null : 'snow',
      definitionSource: 2, definitionSourceKey: 'winter' }, row.visibility_tokens)
  })
  expect((await f.read()).visibility).toEqual({ valid: true, violations: [] })
})
