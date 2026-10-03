import { expect, it } from 'vitest'
import { nativeEquipmentPackFixture, packId as id } from './fixtures/native-equipment-pack'
import { nativePackProfiles } from '../../web/lib/animacraft/native-pack-profiles'
import { NativePackDefinitionsFieldBcs, nativePackDefinitionsCommitment } from '../../web/lib/animacraft/native-pack-definitions'
import { EquipmentPackReleaseBcs, EquipmentPackStyleBcs, EquipmentPackStyleKeyBcs } from '../../web/lib/animacraft/native-equipment-pack'
import { bcs } from '@mysten/sui/bcs'
import { packSelectionEligibility } from '../../web/lib/animacraft/equipment-eligibility'
import { readNativeEquipment } from '../../web/lib/animacraft/native-equipment'
function fixture() {
  const f = nativeEquipmentPackFixture(); const { definitionId, definitions } = f.addOwnedColor()
  definitions.rows.parts = [{ sequence: '0', key: 'body', label: 'Owned body', kind: 0, render_order: '0', menu_order: '0',
    visible: true, required: false, slot_mode: 1, capacity: '2', track_keys: ['front'], visibility_tokens: [],
    visibility_commitment: Array(32).fill(1), payload_commitment: Array(32).fill(1) }]
  definitions.commitment = nativePackDefinitionsCommitment(definitions)
  f.set(definitionId, NativePackDefinitionsFieldBcs, row => { row.value = definitions })
  const profile = nativePackProfiles(definitions, 2)[0]
  f.editLoadout(loadout => {
    loadout.attached_pack_definitions = [{ release_id: f.releaseId, definition_commitment: definitions.commitment }]
    loadout.definition_slots.push({ source_definition_id: f.releaseId, part_key: 'body',
      profile_commitment: profile.profile_commitment, start: '1', capacity: '1' })
    loadout.selections.push(null)
  })
  return { ...f, definitionId, definitions, profile }
}
it('matches the independent Animacraft profile rolling commitment vector', () => {
  const f = fixture()
  expect(Buffer.from(f.profile.profile_commitment).toString('hex')).toBe('ce7673d8a85111bcf7dc871def13dec51decd284da840c1a2e8ee758d6388450')
})
it('reads a persisted Pack extension with same-key Base and owned Parts without merging slots', async () => {
  const f = fixture(); const snapshot = await f.readPack()
  expect(snapshot.source!.slots.map(row => [row.source_definition_id, row.part_key, row.slotStart, row.capacity]))
    .toEqual([[id(10), 'body', 0, '1'], [f.releaseId, 'body', 1, '1']])
  expect(snapshot.source!.slots[1].makerCapacity).toBe('2')
  expect(snapshot.equipment!.loadout.selections).toHaveLength(2)
  expect(snapshot.updateSource?.packDefinitions?.[0].releaseId).toBe(f.releaseId)
})
it.each([0, 1])('places a Pack-owned Part mode=%s only into its committed Release slot, not the same-key Base slot', async mode => {
  const f = fixture()
  f.definitions.rows.parts[0].slot_mode = mode
  f.definitions.commitment = nativePackDefinitionsCommitment(f.definitions)
  f.set(f.definitionId, NativePackDefinitionsFieldBcs, row => { row.value = f.definitions })
  f.editLoadout(row => {
    row.attached_pack_definitions[0].definition_commitment = f.definitions.commitment
    row.definition_slots[1].profile_commitment = nativePackProfiles(f.definitions, 2)[0].profile_commitment
  })
  f.set(f.packStyleId, bcs.struct('Field', { id: bcs.Address, name: EquipmentPackStyleKeyBcs, value: EquipmentPackStyleBcs }),
    row => { row.value.definition_sources.part = 2 })
  const snapshot = await f.readPack()
  const selection = { baseRegistryId: id(85), releaseId: f.releaseId, passId: f.passId,
    partKey: 'body', itemKey: 'pack-hat', styleKey: 'snow', swatchKey: 'violet' }
  expect(packSelectionEligibility(snapshot, { selection })).toMatchObject({ allowed: true, slot: 1 })
  expect(packSelectionEligibility(snapshot, { selection, targetSelectionIndex: '0' }).allowed).toBe(false)
  expect(packSelectionEligibility(snapshot, { selection, replaces: { kind: 'base', itemId: id(84) } }).allowed).toBe(false)
})
it('reads exact attached-Pack final proof sources for transaction preparation', async () => {
  const f = fixture()
  const snapshot = await readNativeEquipment(f.client, f.target, { soulId: id(12), stateId: id(14), update: true })
  expect(snapshot.updateSource?.packDefinitions).toEqual([{ releaseId: f.releaseId,
    paymentCoinType: `${id(2)}::sui::SUI`, definitionCommitment: Buffer.from(f.definitions.commitment).toString('hex') }])
})
it('reads attached proof sources for removal without current Maker access or active commerce', async () => {
  const f = fixture()
  f.objects.delete(id(10)); f.objects.delete(id(20)); f.objects.delete(id(83)); f.objects.delete(f.passId)
  f.set(f.releaseId, EquipmentPackReleaseBcs, row => { row.lifecycle = 3 })
  const snapshot = await readNativeEquipment(f.client, f.target, { soulId: id(12), stateId: id(14), update: true })
  expect(snapshot.updateSource?.packDefinitions?.[0].releaseId).toBe(f.releaseId)
})
it.each(['root', 'commitment', 'custody', 'type'])('rejects %s attached proof source before building an update', async problem => {
  const f = fixture()
  if (problem === 'root') f.set(f.releaseId, EquipmentPackReleaseBcs, row => { row.root_id = id(999) })
  if (problem === 'commitment') f.editLoadout(row => { row.attached_pack_definitions[0].definition_commitment[0] ^= 1 })
  if (problem === 'custody') f.objects.get(f.definitionId).owner.address = id(999)
  if (problem === 'type') f.objects.get(f.releaseId).objectType = `${id(999)}::runtime_v8::PackReleaseV8<${id(2)}::sui::SUI>`
  await expect(readNativeEquipment(f.client, f.target, { soulId: id(12), stateId: id(14), update: true })).rejects.toThrow()
})
it.each(['root', 'definition', 'profile', 'range', 'unknown', 'duplicate', 'foreign-selection'])('rejects %s persisted Pack slot mismatch', async problem => {
  const f = fixture()
  if (problem === 'root') f.set(f.releaseId, EquipmentPackReleaseBcs, row => { row.root_id = id(999) })
  else f.editLoadout(loadout => {
    if (problem === 'definition') loadout.attached_pack_definitions[0].definition_commitment[0] ^= 1
    if (problem === 'profile') loadout.definition_slots[1].profile_commitment[0] ^= 1
    if (problem === 'range') loadout.definition_slots[1].start = '2'
    if (problem === 'unknown') loadout.definition_slots[1].source_definition_id = id(999)
    if (problem === 'duplicate') loadout.attached_pack_definitions.push(loadout.attached_pack_definitions[0])
    if (problem === 'foreign-selection') {
      loadout.selections[1] = { ...loadout.selections[0], selection_index: '1' }; loadout.selection_count = '2'
    }
  })
  await expect(f.readPack()).rejects.toThrow()
})
it('does not let an explicit Base target remove a same-key owned slot', async () => {
  const f = fixture()
  f.editLoadout(loadout => {
    loadout.selections[1] = { ...loadout.selections[0], source_class: 1, source_definition_id: f.releaseId,
      access_subject: f.passId, selection_index: '1' }
    loadout.selections[0] = null
  })
  const snapshot = await f.readPack()
  const eligibility = packSelectionEligibility(snapshot, { targetSelectionIndex: '0',
    replaces: { kind: 'selection', selectionIndex: '1' }, selection: {
      baseRegistryId: id(85), releaseId: f.releaseId, passId: f.passId,
      partKey: 'body', itemKey: 'pack-hat', styleKey: 'snow', swatchKey: 'violet',
    } })
  expect(eligibility).toMatchObject({ allowed: false, reason: 'Choose a replacement in the same definition namespace.' })
})
it.each([0, 1, 2])('derives exact admitted profile policy for admission=%s', admission => {
  const f = fixture(); const profile = nativePackProfiles(f.definitions, admission)[0]
  expect(profile.behavior).toBe(admission === 0 ? 1 : 3)
  expect(profile.admission_ceiling).toBe(admission)
  f.definitions.rows.parts[0].required = true
  expect(() => nativePackProfiles(f.definitions, admission)).toThrow('profile policy mismatch')
})
