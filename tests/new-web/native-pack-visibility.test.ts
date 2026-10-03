import { bcs } from '@mysten/sui/bcs'
import { expect, it } from 'vitest'
import { nativeRenderSourceFixture } from './fixtures/native-render-source'
import { EquipmentPackStyleBcs, EquipmentPackStyleKeyBcs } from '../../web/lib/animacraft/native-equipment-pack'
import { NativePackDefinitionsFieldBcs, nativePackDefinitionsCommitment } from '../../web/lib/animacraft/native-pack-definitions'
import { nativeVisibilityCommitment, type NativeVisibilityToken } from '../../web/lib/animacraft/native-visibility'
const StyleField = bcs.struct('Field', { id: bcs.Address, name: EquipmentPackStyleKeyBcs, value: EquipmentPackStyleBcs })
const tokens: NativeVisibilityToken[] = [{ opcode: 0, arity: 0,
  selector: { source: 1, source_key: null, part_key: 'body', item_key: 'hat', style_key: 'red' } }]
it('matches the independent Animacraft Pack visibility commitment vector', () => {
  expect(nativeVisibilityCommitment({ level: 'STYLE', partKey: 'body', itemKey: 'pack-hat', styleKey: 'snow',
    definitionSource: 2, definitionSourceKey: 'winter' }, []))
    .toEqual([213,209,176,204,15,192,14,228,80,73,60,26,113,65,59,241,141,223,221,182,168,126,110,180,84,250,129,174,83,136,221,249])
})
function fixture() {
  const f = nativeRenderSourceFixture(); const { definitionId } = f.addOwnedColor()
  // All three Style references are Base. Its Pack-local Style condition still applies.
  f.set(f.packStyleId, StyleField, row => { row.value.definition_sources.color = 1; row.value.default_swatch_key = 'snow' })
  const update = (change: (value: ReturnType<typeof NativePackDefinitionsFieldBcs.parse>['value']) => void) => {
    f.set(definitionId, NativePackDefinitionsFieldBcs, row => {
      change(row.value); row.value.commitment = nativePackDefinitionsCommitment(row.value)
    })
  }
  update(value => {
    const row = value.rows.visibility[1]
    row.visibility_tokens = tokens
    row.visibility_commitment = nativeVisibilityCommitment({ level: 'STYLE', partKey: 'body', itemKey: 'pack-hat',
      styleKey: 'snow', definitionSource: 2, definitionSourceKey: 'winter' }, tokens)
  })
  return { ...f, definitionId, update }
}
it('checks Pack Style conditions even when Part/Track/Color all come from Base', async () => {
  const f = fixture()
  const hidden = await f.readRender([f.packSelection])
  expect(hidden.visibility).toEqual({ valid: false, violations: [{ selectionIndex: 0, levels: ['STYLE'] }] })
  expect(hidden.layers[0].swatch?.key).toBe('gold')
  const visible = await f.readRender([f.baseSelection, { ...f.packSelection, selection_index: '1' }])
  expect(visible.visibility).toEqual({ valid: true, violations: [] })
})
it.each(['missing', 'duplicate', 'foreign-subject', 'source', 'commitment', 'malformed'])('rejects %s Pack visibility evidence', async problem => {
  const f = fixture()
  f.update(value => {
    const row = value.rows.visibility[1]
    if (problem === 'missing') value.rows.visibility.pop()
    if (problem === 'duplicate') value.rows.visibility.push({ ...row })
    if (problem === 'foreign-subject') row.style_key = 'other'
    if (problem === 'source') row.definition_source = 1
    if (problem === 'commitment') row.visibility_commitment[0] ^= 1
    if (problem === 'malformed') row.visibility_tokens[0].arity = 1
  })
  await expect(f.readRender([f.packSelection])).rejects.toThrow(/visibility|Visibility/)
})
it('rejects another Pack namespace program even when the outer definition hash is valid', async () => {
  const f = fixture()
  f.update(value => { value.rows.visibility[1].visibility_commitment = nativeVisibilityCommitment({
    level: 'STYLE', partKey: 'body', itemKey: 'pack-hat', styleKey: 'snow',
    definitionSource: 2, definitionSourceKey: 'foreign',
  }, tokens) })
  await expect(f.readRender([f.packSelection])).rejects.toThrow('Visibility subject commitment mismatch')
})
it('does not interpret malformed finalized definitions as an absent simple Pack', async () => {
  const f = fixture(); f.objects.get(f.definitionId).contents.value = new Uint8Array([0])
  await expect(f.readRender([f.packSelection])).rejects.toThrow()
  await expect(f.readPack()).rejects.toThrow()
})
it('preserves the actual inherited Base Item condition as well as the Pack Style condition', async () => {
  const f = fixture()
  const key = { part_key: 'body', item_key: 'hat', style_key: 'snow' }
  f.field(f.stylesId, f.runtimeType('PackStyleKeyV8'), EquipmentPackStyleKeyBcs, key,
    f.runtimeType('PackStyleV8'), EquipmentPackStyleBcs, { ...f.packStyle, ...key })
  f.update(value => {
    for (const row of value.rows.visibility) {
      row.item_key = 'hat'; row.visibility_tokens = []
      row.definition_source = row.subject === 1 ? 1 : 2
      row.visibility_commitment = nativeVisibilityCommitment({ level: row.subject === 1 ? 'ITEM' : 'STYLE',
        partKey: 'body', itemKey: 'hat', styleKey: row.style_key,
        definitionSource: row.definition_source as 1 | 2, definitionSourceKey: row.subject === 1 ? null : 'winter' }, [])
    }
  })
  f.setVisibility('ITEM', tokens)
  const hidden = await f.readRender([{ ...f.packSelection, item_key: 'hat' }])
  expect(hidden.visibility.violations).toEqual([{ selectionIndex: 0, levels: ['ITEM'] }])
})
