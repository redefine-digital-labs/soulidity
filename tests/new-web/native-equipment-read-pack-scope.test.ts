import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { nativeEquipmentReadFixture } from './fixtures/native-equipment-read'
import { nativePackProfiles } from '../../web/lib/animacraft/native-pack-profiles'
import { NativePackDefinitionsFieldBcs, nativePackDefinitionsCommitment } from '../../web/lib/animacraft/native-pack-definitions'
import { EquipmentPackStyleBcs, EquipmentPackStyleKeyBcs } from '../../web/lib/animacraft/native-equipment-pack'

const StyleField = bcs.struct('Field', { id: bcs.Address, name: EquipmentPackStyleKeyBcs, value: EquipmentPackStyleBcs })
function fixture(ownPart: boolean, selectOwnPart: boolean) {
  const f = nativeEquipmentReadFixture('pack'), p = f.pack!
  const { definitionId, definitions } = p.addOwnedColor()
  if (ownPart) definitions.rows.parts = [{ sequence: '0', key: 'body', label: 'Pack body', kind: 0,
    render_order: '0', menu_order: '0', visible: true, required: false, slot_mode: 1, capacity: '3',
    track_keys: ['front'], visibility_tokens: [], visibility_commitment: Array(32).fill(1), payload_commitment: Array(32).fill(1) }]
  definitions.commitment = nativePackDefinitionsCommitment(definitions)
  p.set(definitionId, NativePackDefinitionsFieldBcs, row => { row.value = definitions })
  f.objects.set(definitionId, p.objects.get(definitionId))
  if (selectOwnPart) f.set(p.packStyleId, StyleField, row => { row.value.definition_sources.part = 2 })
  f.editLoadout(loadout => {
    loadout.attached_pack_definitions = [{ release_id: p.releaseId, definition_commitment: definitions.commitment }]
    loadout.selections[0]!.swatch_key = 'violet'
    if (ownPart) {
      const profile = nativePackProfiles(definitions, 2)[0]
      loadout.definition_slots.push({ source_definition_id: p.releaseId, part_key: 'body',
        profile_commitment: profile.profile_commitment, start: '1', capacity: '1' })
      loadout.selections.push(null)
      if (selectOwnPart) {
        loadout.selections[1] = { ...loadout.selections[0]!, selection_index: '1' }
        loadout.selections[0] = null
      }
    }
  })
  return { ...f, definitionId, selectedIndex: selectOwnPart ? 1 : 0 }
}

it('reads protected Pack-owned color without falling back to a same-key Base color', async () => {
  const f = fixture(false, false)
  expect((await f.readEquipment()).kind).toBe('pack')
})
it.each([false, true])('reads protected Pack style with an attached own Part (selected=%s)', async selected => {
  const f = fixture(true, selected)
  expect(await f.readEquipment(f.selectedIndex)).toMatchObject({ kind: 'pack', selectionIndex: f.selectedIndex })
})
it('rejects a Pack-owned style placed into the same-named Base position', async () => {
  const f = fixture(true, false)
  f.set(f.pack!.packStyleId, StyleField, row => { row.value.definition_sources.part = 2 })
  await expect(f.readEquipment()).rejects.toThrow('Pack selection Part namespace mismatch')
})
it('rejects an inherited Base style placed into the same-named Pack position', async () => {
  const f = fixture(true, true)
  f.set(f.pack!.packStyleId, StyleField, row => { row.value.definition_sources.part = 1 })
  await expect(f.readEquipment(1)).rejects.toThrow('Pack selection Part namespace mismatch')
})
it('does not accept the Base swatch as a fallback for a Pack-owned color', async () => {
  const f = fixture(false, false)
  f.editLoadout(row => { row.selections[0]!.swatch_key = 'snow' })
  await expect(f.readEquipment()).rejects.toThrow('Selected color/swatch missing')
})
it('rejects an attached definition commitment substituted in the equipment state', async () => {
  const f = fixture(true, true)
  f.editLoadout(row => { row.attached_pack_definitions[0].definition_commitment = Array(32).fill(99) })
  await expect(f.readEquipment(1)).rejects.toThrow('Attached Pack definition commitment mismatch')
})
it('rechecks the attached definition after protected metadata is read', async () => {
  const f = fixture(true, true)
  const original = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).getObject = async (request: any) => {
    const result = await original(request)
    if (request.objectId === f.protectedAssetId) f.objects.get(f.definitionId).digest = 'changed-after-layout-read'
    return result
  }
  await expect(f.readEquipment(1)).rejects.toMatchObject({ status: 409 })
})
