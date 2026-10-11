import { expect, it } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { appendAnimacraftEquipmentV8RemovalPlan, type AnimacraftEquipmentV8RemovalPlan,
  beginAnimacraftEquipmentV8Update, appendRemoveAnimacraftEquipmentV8,
  appendProveEquipmentPackDefinitionsV8, finishAnimacraftEquipmentV8Update } from '@soulidity/sdk'

const id = (n: number) => '0x' + n.toString(16).padStart(64, '0')
const plan = (): AnimacraftEquipmentV8RemovalPlan => ({
  scope: { target: { soulidityCallablePackageId: id(1), runtimeOriginalPackageId: id(2), protocolConfigId: id(3) },
    soulStateId: id(4), equipmentId: id(5), expectedRevision: '9007199254740993' },
  definitionRegistryId: id(6), baseRegistryId: id(7),
  removals: [{ kind: 'external', itemId: id(8) }, { kind: 'selection', selectionIndex: '499' }],
  packs: [{ runtimeCallablePackageId: id(2), paymentCoinType: '0x2::sui::SUI', releaseId: id(9), bindingIndex: '0' }],
})

it('appends only explicit partial removal and final Pack proofs, leaving the binding open', () => {
  const tx = new Transaction(), p = plan()
  expect(appendAnimacraftEquipmentV8RemovalPlan(tx, p)).toBe(9007199254740995n)
  const data = tx.getData(), calls = data.commands.flatMap(c => c.MoveCall ? [c.MoveCall] : [])
  expect(calls.map(c => c.function)).toEqual(['begin_update_v8', 'unequip_external_v8', 'clear_selection_v8',
    'prove_equipment_pack_definitions_v8', 'finish_update_v8'])
  const slot = calls[2].arguments[3] as { Input: number }
  expect(bcs.u64().fromBase64(data.inputs[slot.Input].Pure!.bytes)).toBe('499')
  expect(data.commands.some(c => c.TransferObjects)).toBe(false)
  expect(data.inputs.some(i => i.UnresolvedObject?.objectId === id(10))).toBe(false)
  expect(p).toEqual(plan())
})

it('preserves the previous explicit primitive composition including input order and encoded values', () => {
  const p = plan(), actual = new Transaction(), previous = new Transaction()
  appendAnimacraftEquipmentV8RemovalPlan(actual, p)
  const update = beginAnimacraftEquipmentV8Update(previous, p.scope)
  p.removals.forEach((removal, index) => appendRemoveAnimacraftEquipmentV8(previous,
    { ...p.scope, update, expectedRevision: BigInt(p.scope.expectedRevision) + BigInt(index), previous: removal }))
  const packDefinitionProofs = p.packs.map(pack => appendProveEquipmentPackDefinitionsV8(previous,
    { ...pack, equipmentId: p.scope.equipmentId, definitionRegistryId: p.definitionRegistryId, baseRegistryId: p.baseRegistryId }))
  finishAnimacraftEquipmentV8Update(previous, { ...p.scope, update,
    definitionRegistryId: p.definitionRegistryId, baseRegistryId: p.baseRegistryId, packDefinitionProofs })
  expect(actual.getData()).toEqual(previous.getData())
})

it('accepts maximum revision with zero removals and emits no inputs or commands', () => {
  const tx = new Transaction(), p = plan(); p.removals = []; p.scope.expectedRevision = '18446744073709551615'
  const before = tx.getData()
  expect(appendAnimacraftEquipmentV8RemovalPlan(tx, p)).toBe(18446744073709551615n)
  expect(tx.getData()).toEqual(before)
})

const invalid: Array<[string, (p: AnimacraftEquipmentV8RemovalPlan) => void]> = [
  ...(['base', 'external'] as const).flatMap(kind => ['equipmentId', 'expectedRevision', 'update'].map(field =>
    [`${kind} scope override ${field}`, (p: AnimacraftEquipmentV8RemovalPlan) => {
      p.removals = [{ kind, itemId: id(8), [field]: 'bad' } as never]
    }] as [string, (p: AnimacraftEquipmentV8RemovalPlan) => void])),
  ['array removal', p => { p.removals = [Object.assign([], { kind: 'base', itemId: id(8) }) as never] }],
  ['noncanonical state', p => { p.scope.soulStateId = '0x4' }],
  ['zero equipment', p => { p.scope.equipmentId = id(0) }],
  ['bad target', p => { p.scope.target.runtimeOriginalPackageId = 'bad' }],
  ['bad protocol', p => { p.scope.target.protocolConfigId = 'bad' }],
  ['bad package', p => { p.scope.target.soulidityCallablePackageId = 'bad' }],
  ['bad final definition', p => { p.definitionRegistryId = 'bad' }],
  ['bad final base', p => { p.baseRegistryId = 'bad' }],
  ['number revision', p => { p.scope.expectedRevision = 1 as unknown as string }],
  ['revision leading zero', p => { p.scope.expectedRevision = '01' }],
  ['revision overflow', p => { p.scope.expectedRevision = '18446744073709551615' }],
  ['negative revision', p => { p.scope.expectedRevision = -1n }],
  ['bad late item', p => { p.removals.push({ kind: 'base', itemId: 'bad' }) }],
  ['unknown removal', p => { p.removals.push({ kind: 'pack' } as never) }],
  ['duplicate cross-kind instance', p => { p.removals.push({ kind: 'base', itemId: id(8) }) }],
  ['duplicate slot', p => { p.removals.push({ kind: 'selection', selectionIndex: '499' }) }],
  ['out-of-bounds slot', p => { p.removals.push({ kind: 'selection', selectionIndex: '500' }) }],
  ['noncanonical slot', p => { p.removals.push({ kind: 'selection', selectionIndex: '01' }) }],
  ['excess removals', p => { p.removals = Array(501).fill({ kind: 'base', itemId: id(8) }) }],
  ['Pack order', p => { p.packs[0].bindingIndex = '1' }],
  ['duplicate Pack', p => { p.packs.push({ ...p.packs[0], bindingIndex: '1' }) }],
  ['Pack ID', p => { p.packs[0].releaseId = 'bad' }],
  ['Pack callable', p => { p.packs[0].runtimeCallablePackageId = 'bad' }],
  ['Pack coin', p => { p.packs[0].paymentCoinType = 'bad' }],
  ['excess Packs', p => { p.packs = Array(501).fill(p.packs[0]) }],
  ['sparse removals', p => { p.removals = Array(2) }],
  ['sparse Packs', p => { p.packs = Array(2) }],
]
it.each(invalid)('rejects %s before mutating an existing transaction', (_name, corrupt) => {
  const tx = new Transaction(), p = plan()
  tx.moveCall({ target: `${id(1)}::test::existing`, arguments: [tx.pure.u64(7)] })
  const before = tx.getData(); corrupt(p)
  expect(() => appendAnimacraftEquipmentV8RemovalPlan(tx, p)).toThrow()
  expect(tx.getData()).toEqual(before)
  // Rejected prevalidation must not consume the per-transaction update slot.
  expect(() => appendAnimacraftEquipmentV8RemovalPlan(tx, plan())).not.toThrow()
})

it('validates empty plans too, without adding an update guard', () => {
  const tx = new Transaction(), p = plan(); p.removals = []; p.packs[0].bindingIndex = '4'
  expect(() => appendAnimacraftEquipmentV8RemovalPlan(tx, p)).toThrow()
  expect(tx.getData().commands).toEqual([])
})

it('accepts the full 500-slot capacity and exact final u64 boundary', () => {
  const tx = new Transaction(), p = plan()
  p.scope.expectedRevision = 18446744073709551115n
  p.removals = Array.from({ length: 500 }, (_, index) => ({ kind: 'selection', selectionIndex: String(index) }))
  p.packs = Array.from({ length: 500 }, (_, index) => ({ ...p.packs[0], releaseId: id(index + 100), bindingIndex: String(index) }))
  expect(appendAnimacraftEquipmentV8RemovalPlan(tx, p)).toBe(18446744073709551615n)
  const calls = tx.getData().commands.flatMap(c => c.MoveCall ? [c.MoveCall] : [])
  expect(calls.filter(c => c.function === 'clear_selection_v8')).toHaveLength(500)
  expect(calls.filter(c => c.function === 'prove_equipment_pack_definitions_v8')).toHaveLength(500)
  expect(calls.at(-1)!.function).toBe('finish_update_v8')
})
