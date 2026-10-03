import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { buildSelectedAnimacraftSoulSaleV8Tx, type SelectedAnimacraftSoulSaleV8 } from '@soulidity/sdk'
const id = (n: number) => '0x' + n.toString(16).padStart(64, '0')
const row = (n = 10): SelectedAnimacraftSoulSaleV8 => ({
  target: { soulidityCallablePackageId: id(1), marketConfigV2Id: id(2), kioskRegistryId: id(3), soulTransferPolicyId: id(4), kioskPackageId: id(5) },
  soulStateId: id(n), provenanceBindingId: id(n + 1), currentKioskId: id(6), currentKioskCapOnChainId: id(7), priceAtomic: 100n,
  equipment: { scope: { target: { soulidityCallablePackageId: id(1), runtimeOriginalPackageId: id(8), protocolConfigId: id(9) },
    soulStateId: id(n), equipmentId: id(n + 2), expectedRevision: '9007199254740993' },
    definitionRegistryId: id(90), baseRegistryId: id(91),
    removals: [{ kind: 'base', itemId: id(n + 3) }, { kind: 'external', itemId: id(n + 4) }, { kind: 'selection', selectionIndex: '8' }],
    packs: [{ runtimeCallablePackageId: id(8), paymentCoinType: '0x2::sui::SUI', releaseId: id(92), bindingIndex: '0' }] },
})
it('composes complete removal, final Pack proof, close and listing in one exact selected-Soul transaction', () => {
  const data = buildSelectedAnimacraftSoulSaleV8Tx([row()]).getData()
  const calls = data.commands.flatMap(command => command.MoveCall ? [command.MoveCall] : [])
  expect(calls.map(call => call.function)).toEqual(['begin_update_v8', 'unequip_base_v8', 'unequip_external_v8',
    'clear_selection_v8', 'prove_equipment_pack_definitions_v8', 'finish_update_v8', 'close_empty_equipment_v8',
    'ensure_personal_kiosk_registered_v2', 'list_animacraft_v8_soul_fixed_price', 'finalize_soul_listing'])
  const close = calls.find(call => call.function === 'close_empty_equipment_v8')!
  const arg = close.arguments[3] as { Input: number }
  expect(bcs.u64().fromBase64(data.inputs[arg.Input].Pure!.bytes)).toBe('9007199254740996')
  expect(data.commands.some(command => command.TransferObjects)).toBe(false)
  expect(calls.filter(call => call.module === 'market').some(call => /item|component/.test(call.function))).toBe(false)
})
it('lists exactly the selected two Souls, never a third inventory entry', () => {
  const first = row(), second = row(20); second.equipment = null
  const data = buildSelectedAnimacraftSoulSaleV8Tx([first, second]).getData()
  const sales = data.commands.flatMap(c => c.MoveCall?.function === 'list_animacraft_v8_soul_fixed_price' ? [c.MoveCall] : [])
  expect(sales).toHaveLength(2)
  expect(sales.map(c => data.inputs[(c.arguments[5] as { Input: number }).Input].UnresolvedObject!.objectId)).toEqual([id(10), id(20)])
  expect(data.inputs.some(input => input.UnresolvedObject?.objectId === id(30))).toBe(false)
})
it('closes an already empty binding without unnecessary mutation or Pack reads', () => {
  const r = row(); r.equipment!.removals = []
  const data = buildSelectedAnimacraftSoulSaleV8Tx([r]).getData()
  expect(data.commands[0].MoveCall!.function).toBe('close_empty_equipment_v8')
  expect(data.commands).toHaveLength(4)
})
it('retains the established per-Soul command order for two equipped Souls through the shared composer',()=>{
  const first=row(),second=row(20),calls=buildSelectedAnimacraftSoulSaleV8Tx([first,second]).getData().commands
    .flatMap(command=>command.MoveCall?[command.MoveCall.function]:[])
  const single=['begin_update_v8','unequip_base_v8','unequip_external_v8','clear_selection_v8','prove_equipment_pack_definitions_v8',
    'finish_update_v8','close_empty_equipment_v8','ensure_personal_kiosk_registered_v2','list_animacraft_v8_soul_fixed_price','finalize_soul_listing']
  expect(calls).toEqual([...single,...single])
})
it.each(['duplicate Soul', 'wrong state', 'wrong package', 'duplicate instance', 'duplicate slot', 'overflow', 'pack order'])(
  'rejects %s without exposing a partial transaction', failure => {
    const r = row(), rows = [r]
    if (failure === 'duplicate Soul') rows.push(row())
    if (failure === 'wrong state') r.equipment!.scope.soulStateId = id(99)
    if (failure === 'wrong package') r.equipment!.scope.target.soulidityCallablePackageId = id(99)
    if (failure === 'duplicate instance') r.equipment!.removals.push({ kind: 'external', itemId: id(13) })
    if (failure === 'duplicate slot') r.equipment!.removals.push({ kind: 'selection', selectionIndex: '8' })
    if (failure === 'overflow') r.equipment!.scope.expectedRevision = '18446744073709551615'
    if (failure === 'pack order') r.equipment!.packs[0].bindingIndex = '1'
    expect(() => buildSelectedAnimacraftSoulSaleV8Tx(rows)).toThrow()
  })
it('requires explicit nonempty selection', () => expect(() => buildSelectedAnimacraftSoulSaleV8Tx([])).toThrow())
it('preserves cross-Soul duplicate-instance and duplicate-equipment rejection', () => {
  const first = row(), second = row(20)
  second.equipment!.removals = [{ kind: 'external', itemId: id(13) }]
  expect(() => buildSelectedAnimacraftSoulSaleV8Tx([first, second])).toThrow('Duplicate equipped instance')
  second.equipment!.removals = []
  second.equipment!.scope.equipmentId = first.equipment!.scope.equipmentId
  expect(() => buildSelectedAnimacraftSoulSaleV8Tx([first, second])).toThrow('unique selected Soul')
})
