import { expect, it } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { appendAnimacraftEquipmentV8RemovalPlan } from '@soulidity/sdk'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { fixtureKioskItem } from './fixtures/native-receive'
import { EquipmentBaseItemBcs, EquipmentExternalItemBcs, EquipmentLoadoutBcs, EquipmentBindingFieldBcs,
  EquipmentPointerBcs, equipmentCommitment, readNativeEquipment } from '../../web/lib/animacraft/native-equipment'
import { NativeSoulBcs, NativeSoulBindingBcs, NativeSoulStateBcs } from '../../web/lib/animacraft/native-receive'
import { captureSelectedSaleEquipmentScopes, prepareSelectedSaleEquipment, readSelectedSaleEquipment,
  type SelectedSaleEquipmentScope } from '../../web/lib/animacraft/native-selected-equipment-sale'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const hash = (n: number) => Array(32).fill(n)
const selected = (sellSoul = false): SelectedSaleEquipmentScope => ({ soulId: id(12), stateId: id(14), sellSoul,
  items: [{ kind: 'base', itemId: id(84) }] })
function fixture() {
  const f = nativeEquipmentSourceFixture()
  f.addExternal()
  f.set(id(102), EquipmentExternalItemBcs, item => { item.equip_lock = { loadout_id: id(80), equip_revision: '1', selection_index: '2' } })
  f.editLoadout(loadout => {
    const first = loadout.selections[0]
    loadout.revision = '9007199254740993'
    loadout.selections = [first, null,
      { ...first, selection_index: '2', part_key: 'external-part', source_class: 2,
        source_definition_id: id(101), item_key: 'external-hat', style_key: 'blue',
        access_subject: id(102), asset_content_commitment: hash(5) },
      { ...first, selection_index: '3', part_key: 'pack-part', source_class: 1,
        source_definition_id: id(150), access_subject: id(151) }]
    loadout.definition_slots = ['body', 'empty-part', 'external-part', 'pack-part'].map((part_key, index) => ({
      source_definition_id: id(10), part_key, profile_commitment: hash(1), start: String(index), capacity: '1',
    }))
    loadout.selection_count = '3'
  })
  const read = () => readNativeEquipment(f.client, f.target, { soulId: id(12), stateId: id(14), update: true })
  return { ...f, read }
}

it('removes only the explicitly selected instance while retaining sparse External/Pack slots and Soul binding', async () => {
  const f = fixture(), snapshot = await f.read(), before = structuredClone(snapshot)
  const [row] = prepareSelectedSaleEquipment(id(11), [selected()], [snapshot])
  expect(row.sellSoul).toBe(false)
  expect(row.selectedItems).toEqual([{ kind: 'base', itemId: id(84), ownershipEpoch: '0', selectionIndex: '0' }])
  expect(row.equipment).toMatchObject({ closeBinding: false, finalRevision: '9007199254740994', finalSelectionCount: '2',
    retainedSelectionIndexes: ['2', '3'], plan: { removals: [{ kind: 'base', itemId: id(84) }] } })
  const after = structuredClone(snapshot.equipment!.loadout); after.selections[0] = null
  expect(row.equipment!.finalCommitment).toBe(equipmentCommitment(after))
  expect(snapshot).toEqual(before)
  const tx = new Transaction()
  expect(appendAnimacraftEquipmentV8RemovalPlan(tx, row.equipment!.plan)).toBe(9007199254740994n)
  const calls = tx.getData().commands.flatMap(command => command.MoveCall ? [command.MoveCall.function] : [])
  expect(calls).toEqual(['begin_update_v8', 'unequip_base_v8', 'finish_update_v8'])
  expect(tx.getData().commands.some(command => command.TransferObjects)).toBe(false)
  expect(tx.getData().inputs.some(input => input.UnresolvedObject?.objectId === id(102))).toBe(false)
})

it('mixed Soul and equipment selection performs one complete removal plan, never removes a selected instance twice', async () => {
  const f = fixture(), snapshot = await f.read()
  const [row] = prepareSelectedSaleEquipment(id(11), [selected(true)], [snapshot])
  expect(row.equipment).toMatchObject({ closeBinding: true, finalRevision: '9007199254740996', finalSelectionCount: '0',
    retainedSelectionIndexes: [], plan: { removals: [{ kind: 'base', itemId: id(84) },
      { kind: 'external', itemId: id(102) }, { kind: 'selection', selectionIndex: '3' }] } })
  expect(row.selectedItems.map(item => item.itemId)).toEqual([id(84)])
})

it('retains an empty binding when all instances, but not the Soul, are selected', async () => {
  const f = fixture()
  f.editLoadout(loadout => { loadout.selections[3] = null; loadout.selection_count = '2' })
  const request = selected(); request.items.push({ kind: 'external', itemId: id(102) })
  const [row] = prepareSelectedSaleEquipment(id(11), [request], [await f.read()])
  expect(row.equipment!.closeBinding).toBe(false)
  expect(row.equipment!.retainedSelectionIndexes).toEqual([])
  expect(row.equipment!.finalSelectionCount).toBe('0')
})

it('keeps explicit sale item order but uses canonical sparse-slot order for removals and final Pack proofs', async () => {
  const f = fixture(), snapshot = await f.read()
  // Mapper-only Pack source fixture; real attached-proof enforcement is also
  // exercised by the Move partial-sale integration, not claimed from this data.
  snapshot.equipment!.loadout.attached_pack_definitions = [{ release_id: id(160), definition_commitment: hash(8) }]
  snapshot.equipment!.loadout.commitment = [...Buffer.from(equipmentCommitment(snapshot.equipment!.loadout), 'hex')]
  snapshot.updateSource!.packDefinitions = [{ releaseId: id(160), paymentCoinType: '0x2::sui::SUI', definitionCommitment: '08'.repeat(32) }]
  const request = selected(); request.items.unshift({ kind: 'external', itemId: id(102) })
  const [row] = prepareSelectedSaleEquipment(id(11), [request], [snapshot])
  expect(row.selectedItems.map(item => item.itemId)).toEqual([id(102), id(84)])
  expect(row.equipment!.plan.removals).toEqual([{ kind: 'base', itemId: id(84) }, { kind: 'external', itemId: id(102) }])
  const tx = new Transaction(); appendAnimacraftEquipmentV8RemovalPlan(tx, row.equipment!.plan)
  expect(tx.getData().commands.flatMap(command => command.MoveCall ? [command.MoveCall.function] : []))
    .toEqual(['begin_update_v8', 'unequip_base_v8', 'unequip_external_v8', 'prove_equipment_pack_definitions_v8', 'finish_update_v8'])
  request.items.pop(); snapshot.updateSource!.packDefinitions[0].releaseId = id(999)
  expect(row.equipment!.plan.packs[0].releaseId).toBe(id(160))
})

it.each(['none', 'duplicate-row', 'duplicate-item', 'unknown-kind', 'unknown-field', 'usage-right', 'noncanonical', 'too-many'])(
  'rejects invalid explicit selection before any raw calls: %s', async reason => {
    const f = fixture(), rows: any[] = [selected()]
    if (reason === 'none') rows[0].items = []
    if (reason === 'duplicate-row') rows.push({ ...selected(), items: [{ kind: 'external', itemId: id(102) }] })
    if (reason === 'duplicate-item') rows[0].items.push(rows[0].items[0])
    if (reason === 'unknown-kind') rows[0].items[0].kind = 'physical'
    if (reason === 'unknown-field') rows[0].autoSelect = true
    if (reason === 'usage-right') rows[0].items[0] = { kind: 'selection', selectionIndex: '3' }
    if (reason === 'noncanonical') rows[0].items[0].itemId = '0x54'
    if (reason === 'too-many') rows[0].items = Array.from({ length: 21 }, (_, index) => ({ kind: 'base', itemId: id(200 + index) }))
    await expect(readSelectedSaleEquipment(f.client, f.target, id(11), rows)).rejects.toThrow()
    expect(f.calls).toHaveLength(0)
  })

it.each(['owner', 'listed', 'state', 'kind', 'missing', 'nontransferable', 'binding', 'lock', 'epoch', 'commitment', 'overflow'])(
  'rejects changed or unproven selected equipment: %s', async reason => {
    const f = fixture(), snapshot = await f.read(), request = selected()
    if (reason === 'owner') snapshot.owner = id(99)
    if (reason === 'listed') snapshot.listed = true
    if (reason === 'state') snapshot.stateId = id(99)
    if (reason === 'kind') request.items[0].kind = 'external'
    if (reason === 'missing') request.items[0].itemId = id(99)
    if (reason === 'nontransferable') snapshot.equipment!.instances[0].item.transferable = false
    if (reason === 'binding') snapshot.equipment!.binding.ownership_epoch = '1'
    if (reason === 'lock') snapshot.equipment!.instances[0].item.equip_lock!.loadout_id = id(99)
    if (reason === 'epoch') snapshot.equipment!.instances[0].item.ownership_epoch = '1'
    if (reason === 'commitment') snapshot.equipment!.loadout.selections[2]!.style_key = 'changed'
    if (reason === 'overflow') snapshot.equipment!.loadout.revision = '18446744073709551615'
    expect(() => prepareSelectedSaleEquipment(id(11), [request], [snapshot])).toThrow()
  })

it('may unequip a nontransferable instance for a Soul-only sale but never selects it for equipment sale', async () => {
  const f = fixture(), snapshot = await f.read(); snapshot.equipment!.instances[0].item.transferable = false
  const request = selected(true); request.items = []
  expect(prepareSelectedSaleEquipment(id(11), [request], [snapshot])[0].equipment!.plan.removals)
    .toContainEqual({ kind: 'base', itemId: id(84) })
})

it('returns no mutation for a selected unbound Soul and rejects pretending it has equipped instances', async () => {
  const f = fixture(); f.objects.delete(f.pointerId)
  const snapshot = await f.read(), request = selected(true); request.items = []
  expect(prepareSelectedSaleEquipment(id(11), [request], [snapshot])[0].equipment).toBeNull()
  request.items.push({ kind: 'base', itemId: id(84) })
  expect(() => prepareSelectedSaleEquipment(id(11), [request], [snapshot])).toThrow()
})

function twoSoulsFixture() {
  const f = fixture()
  for (const [source, dest, codec] of [[12, 112, NativeSoulBcs], [14, 114, NativeSoulStateBcs], [13, 113, NativeSoulBindingBcs]] as const) {
    const row = structuredClone(f.objects.get(id(source))), value: any = codec.parse(row.contents.value)
    row.objectId = id(dest); value.id = id(dest)
    if (source === 14) value.soul_id = id(112)
    if (source === 13) { value.soul_id = id(112); value.soul_state_id = id(114) }
    row.contents.value = (codec as any).serialize(value).toBytes(); f.objects.set(id(dest), row)
  }
  fixtureKioskItem(f.objects, id(18), id(112))
  for (const [slot, value] of [[9, 113], [10, 180]]) {
    const field = deriveDynamicFieldID(id(114), 'u8', new Uint8Array([slot]))
    f.put(field, '0x2::dynamic_field::Field<u8,0x2::object::ID>', EquipmentPointerBcs, { id: field, name: slot, value: id(value) }, 2, id(114))
  }
  const loadout = EquipmentLoadoutBcs.parse(f.objects.get(id(80)).contents.value)
  loadout.id = id(180); loadout.selections = [loadout.selections[0]]; loadout.definition_slots = [loadout.definition_slots[0]]
  loadout.selections[0]!.access_subject = id(184); loadout.selection_count = '1'
  loadout.commitment = [...Buffer.from(equipmentCommitment(loadout), 'hex')]
  f.put(id(180), f.runtimeType('MakerLoadoutV8'), EquipmentLoadoutBcs, loadout)
  const bindingId = deriveDynamicFieldID(id(180), f.runtimeType('SoulEquipmentKeyV8'), new Uint8Array([0]))
  f.put(bindingId, `0x2::dynamic_field::Field<${f.runtimeType('SoulEquipmentKeyV8')},${f.runtimeType('SoulEquipmentBindingV8')}>`,
    EquipmentBindingFieldBcs, { id: bindingId, name: { dummy_field: false }, value: { soul_id: id(112), soul_state_id: id(114),
      holder: id(11), ownership_epoch: '0', protocol_config_id: id(1) } }, 2, id(180))
  const item = EquipmentBaseItemBcs.parse(f.objects.get(id(84)).contents.value)
  item.id = id(184); item.equip_lock!.loadout_id = id(180)
  f.put(id(184), f.runtimeType('OwnedBaseItemV8'), EquipmentBaseItemBcs, item, 1, id(11))
  const rows = [selected(), { soulId: id(112), stateId: id(114), sellSoul: true, items: [] }]
  return { ...f, rows }
}

it('shares exact raw reads across mixed Soul/equipment scopes and captures intent before the first await', async () => {
  const f = twoSoulsFixture(), get = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  f.client.ledgerService.getObject = async req => { f.rows[0].items = []; return get(req) }
  const result = await readSelectedSaleEquipment(f.client, f.target, id(11), f.rows)
  expect(result.preparations.map(row => [row.soulId, row.equipment!.closeBinding])).toEqual([[id(12), false], [id(112), true]])
  expect(result.preparations[0].selectedItems.map(item => item.itemId)).toEqual([id(84)])
  expect(f.rows[0].items).toEqual([])
})

it('rechecks earlier equipment after a later selected Soul read and never returns a partial result', async () => {
  const f = twoSoulsFixture(), get = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  f.client.ledgerService.getObject = async req => {
    if (req.objectId === id(114) && req.readMask?.paths?.length === 3) f.objects.get(id(84)).version++
    return get(req)
  }
  await expect(readSelectedSaleEquipment(f.client, f.target, id(11), f.rows)).rejects.toMatchObject({ code: 'NATIVE_EQUIPMENT_CHANGED' })
})

it('captures fresh independent intent objects', () => {
  const rows = [selected()], copied = captureSelectedSaleEquipmentScopes(rows)
  rows[0].items[0].itemId = id(99)
  expect(copied[0].items[0].itemId).toBe(id(84))
})
