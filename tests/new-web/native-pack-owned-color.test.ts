import { bcs } from '@mysten/sui/bcs'
import { expect, it } from 'vitest'
import { nativeEquipmentPackFixture, packId as id } from './fixtures/native-equipment-pack'
import { nativeRenderSourceFixture } from './fixtures/native-render-source'
import { EquipmentPackReleaseBcs, EquipmentPackStyleBcs, EquipmentPackStyleKeyBcs,
  equipmentPackStyleColor } from '../../web/lib/animacraft/native-equipment-pack'
import { NativePackDefinitionsFieldBcs, nativePackDefinitionsCommitment } from '../../web/lib/animacraft/native-pack-definitions'
import { packSelectionEligibility } from '../../web/lib/animacraft/equipment-eligibility'
import { packAttachmentEligibility } from '../../web/lib/animacraft/equipment-pack-attachment'

it('retains Base and owned channels with identical keys in the same Pack inventory', async () => {
  const f = nativeEquipmentPackFixture(); f.addOwnedColor()
  const baseStyle = { ...f.packStyle, index: '1', style_key: 'base-style' }
  f.field(f.stylesId, f.runtimeType('PackStyleKeyV8'), EquipmentPackStyleKeyBcs, baseStyle,
    f.runtimeType('PackStyleV8'), EquipmentPackStyleBcs, baseStyle)
  f.set(f.releaseId, EquipmentPackReleaseBcs, value => {
    value.expected_style_count = '2'; value.observed_style_count = '2'; value.styles.size = '2'
  })
  const snapshot = await f.readPack({ passId: f.passId, exactStyles: ['snow', 'base-style'].map(styleKey => ({
    partKey: 'body', itemKey: 'pack-hat', styleKey })) })
  const pack = snapshot.source!.pack!.selected!
  expect(pack.colors.map(row => [row.definition_source, row.key, row.swatches.map(s => s.key)]))
    .toEqual([[2, 'pack-tint', ['violet']], [1, 'pack-tint', ['snow', 'gold']]])
  expect(equipmentPackStyleColor(pack, pack.styles[0])?.swatches[0].key).toBe('violet')
  expect(equipmentPackStyleColor(pack, pack.styles[1])?.swatches[0].key).toBe('snow')
})
it('accepts the owned swatch and rejects a colliding Base swatch for equipment placement', async () => {
  const f = nativeEquipmentPackFixture(); f.addOwnedColor(true)
  f.editLoadout(value => { value.selections = [null]; value.selection_count = '0' })
  const snapshot = await f.readPack()
  const selection = { baseRegistryId: id(85), releaseId: f.releaseId, passId: f.passId,
    partKey: 'body', itemKey: 'pack-hat', styleKey: 'snow', swatchKey: 'violet' }
  expect(packSelectionEligibility(snapshot, { selection })).toMatchObject({ allowed: true, slot: 0 })
  expect(packSelectionEligibility(snapshot, { selection: { ...selection, swatchKey: 'gold' } }).allowed).toBe(false)
})
it('requires explicit attachment even when the authored Pack uses a Base Part', async () => {
  const f = nativeEquipmentPackFixture(); f.addOwnedColor()
  f.editLoadout(value => { value.selections = [null]; value.selection_count = '0' })
  const snapshot = await f.readPack()
  expect(packSelectionEligibility(snapshot, { selection: { baseRegistryId: id(85), releaseId: f.releaseId, passId: f.passId,
    partKey: 'body', itemKey: 'pack-hat', styleKey: 'snow', swatchKey: 'violet' } }))
    .toMatchObject({ allowed: false, reason: 'Attach this Pack’s verified definitions before selecting its styles.' })
})
it('renders owned RGBA and gradients without reading the colliding Base color field', async () => {
  const f = nativeRenderSourceFixture(); f.addOwnedColor(); f.objects.delete(f.colorId)
  const source = await f.readRender([{ ...f.packSelection, swatch_key: 'violet' }])
  expect(source.layers[0].swatch).toEqual({ key: 'violet', rgba: '#8000ffff',
    stops: [{ offset: 0, rgba: '#8000ffff' }, { offset: 1, rgba: '#ffffffff' }] })
  expect(f.requests.some(row => row.objectId === f.colorId)).toBe(false)
})
it.each(['inventory', 'render'])('rejects missing or altered finalized definitions in %s', async consumer => {
  const f = nativeRenderSourceFixture(); const { definitionId } = f.addOwnedColor()
  const read = () => consumer === 'inventory' ? f.readPack() : f.readRender([{ ...f.packSelection, swatch_key: 'violet' }])
  f.set(definitionId, NativePackDefinitionsFieldBcs, row => { row.value.rows.colors[0].swatches[0].rgba = 0 })
  await expect(read()).rejects.toThrow('commitment mismatch')
  f.objects.delete(definitionId)
  await expect(read()).rejects.toThrow()
})
it('does not fall back to a Base swatch when the owned channel lacks that swatch', async () => {
  const f = nativeRenderSourceFixture(); f.addOwnedColor()
  await expect(f.readRender([f.packSelection])).rejects.toThrow('Render swatch mismatch')
})
it.each([[0, 0], [0, 1], [1, 1]])('keeps equipment editable with completion-only rule kind=%i mode=%i', async (kind, targetMode) => {
  const f = nativeRenderSourceFixture(); const { definitionId } = f.addOwnedColor()
  f.set(definitionId, NativePackDefinitionsFieldBcs, row => {
    const selector = { source: 1, source_key: null, part_key: 'body', item_key: null, style_key: null }
    row.value.rows.rules = [{ sequence: '0', key: 'rule', kind,
      trigger: selector, target_mode: targetMode,
      targets: [{ ...selector, item_key: kind === 0 ? 'missing-dependency' : null }], payload_commitment: Array(32).fill(1) }]
    row.value.commitment = nativePackDefinitionsCommitment(row.value)
  })
  const snapshot = await f.readPack()
  expect(snapshot.source!.pack!.selected!.definitionCommitment).toHaveLength(32)
  expect(packAttachmentEligibility(snapshot, { releaseId: f.releaseId, passId: f.passId }).allowed).toBe(true)
  const source = await f.readRender([{ ...f.packSelection, swatch_key: 'violet' }])
  expect(source.visibility).toEqual({ valid: true, violations: [] })
  expect(source.layers[0].swatch?.key).toBe('violet')
})
it.each(['sequence', 'duplicate', 'kind', 'exclude-all', 'empty-targets', 'many-targets', 'hash', 'selector', 'key'])
('rejects malformed %s rule even with a recomputed outer definition commitment', async problem => {
  const f = nativeRenderSourceFixture(); const { definitionId } = f.addOwnedColor()
  f.set(definitionId, NativePackDefinitionsFieldBcs, row => {
    const selector = { source: 1, source_key: null, part_key: 'body', item_key: null, style_key: null }
    const rule = { sequence: '0', key: 'rule', kind: 0, trigger: selector,
      target_mode: 0, targets: [selector], payload_commitment: Array(32).fill(1) }
    row.value.rows.rules = [rule]
    if (problem === 'sequence') rule.sequence = '1'
    if (problem === 'duplicate') row.value.rows.rules.push({ ...rule, sequence: '1' })
    if (problem === 'kind') rule.kind = 2
    if (problem === 'exclude-all') rule.kind = 1
    if (problem === 'empty-targets') rule.targets = []
    if (problem === 'many-targets') rule.targets = Array(33).fill(selector)
    if (problem === 'hash') rule.payload_commitment.pop()
    if (problem === 'selector') selector.source = 4
    if (problem === 'key') rule.key = ''
    row.value.commitment = nativePackDefinitionsCommitment(row.value)
  })
  await expect(f.readPack()).rejects.toThrow(/rule|selector/)
  await expect(f.readRender([{ ...f.packSelection, swatch_key: 'violet' }])).rejects.toThrow(/rule|selector/)
})
it('rejects a forged namespace marker without consulting any definitions', async () => {
  const f = nativeRenderSourceFixture(); f.addOwnedColor()
  f.set(f.packStyleId, bcs.struct('Field', { id: bcs.Address, name: EquipmentPackStyleKeyBcs, value: EquipmentPackStyleBcs }),
    row => { row.value.definition_sources.color = 3 })
  await expect(f.readPack()).rejects.toThrow('definition sources invalid')
  await expect(f.readRender([f.packSelection])).rejects.toThrow('definition sources invalid')
})
