import { expect, it } from 'vitest'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { toBase64 } from '@mysten/sui/utils'
import { validateEquipmentOperationRecord, type EquipmentOperation } from '../../web/lib/animacraft/equipment-operation'
import { equipmentOperationFixture, eid } from './fixtures/equipment-operation'
const base = { kind: 'base' as const, itemId: eid(84), baseRegistryId: eid(85), styleKey: 'red', swatchKey: 'red' }
const external = { kind: 'external' as const, itemId: eid(102), productId: eid(101) }
const operations: EquipmentOperation[] = [{ kind: 'create' }, { kind: 'equip', item: base }, { kind: 'equip', item: external },
  { kind: 'equip', item: base, replaces: { kind: 'base', itemId: eid(84) } },
  { kind: 'equip', item: external, replaces: { kind: 'base', itemId: eid(84) } },
  { kind: 'equip', item: base, replaces: { kind: 'external', itemId: eid(102) } }]
it.each(operations)('accepts exact native SDK operation $kind $item.kind $replaces.kind and adjacent replacement revisions', async operation => {
  const { record, tx } = await equipmentOperationFixture(operation)
  expect(validateEquipmentOperationRecord(record)).toBe(record)
  const data = tx.getData(); const names = data.commands.flatMap(row => row.MoveCall?[row.MoveCall.function]:[])
  if (operation.kind === 'create') {
    expect(names).toEqual(['create_equipment_v8']); expect(record.equipmentId).toBeNull()
    expect(data.commands[0].MoveCall!.arguments).toHaveLength(7)
  } else if (operation.kind === 'equip') {
    expect(names).toEqual(['begin_update_v8',...(operation.replaces ? [`unequip_${operation.replaces.kind}_v8`] : []), `equip_${operation.item.kind}_v8`,'finish_update_v8'])
    const last = data.commands.at(-3)!.MoveCall!
    expect(data.inputs[last.arguments[8].Input!].Pure!.bytes).toBe(toBase64(bcs.u64().serialize(operation.replaces ? '2' : '1').toBytes()))
  }
})
it.each(['revision','style','swatch','extra-command','extra-input','function','type','mutability','owned','argument','source','provenance'])
  ('rejects altered %s even with recomputed digest', async problem => {
    const op = problem === 'provenance' ? operations[0] : operations[3]
    const { record, tx } = await equipmentOperationFixture(op)
    const data = tx.getData(); const call = data.commands.at(problem === 'provenance' ? -1 : -3)!.MoveCall!
    if (problem === 'source') record.source!.makerRootId = eid(999)
    else if (problem === 'provenance') record.provenanceBindingId = eid(999)
    else if (problem === 'revision') data.inputs[call.arguments[8].Input!] = { Pure: { bytes: toBase64(bcs.u64().serialize('1').toBytes()) } } as any
    else if (problem === 'style') data.inputs[call.arguments[10].Input!] = { Pure: { bytes: toBase64(bcs.string().serialize('other').toBytes()) } } as any
    else if (problem === 'swatch') data.inputs[call.arguments[11].Input!] = { Pure: { bytes: toBase64(bcs.option(bcs.string()).serialize(null).toBytes()) } } as any
    else if (problem === 'extra-command') data.commands.push(structuredClone(data.commands[0]))
    else if (problem === 'extra-input') data.inputs.push({ Pure: { bytes: 'AA==' } } as any)
    else if (problem === 'function') call.function = 'create_equipment_v8'
    else if (problem === 'type') call.typeArguments = [`${eid(2)}::other::COIN`]
    else if (problem === 'mutability') data.inputs[data.commands[0].MoveCall!.arguments[0].Input!].Object!.SharedObject!.mutable = true
    else if (problem === 'owned') data.inputs[call.arguments[2].Input!] = { Object: { SharedObject: { objectId: eid(84), initialSharedVersion: '1', mutable: true } } } as any
    else if (problem === 'argument') call.arguments[2] = call.arguments[7]
    const bytes = await Transaction.from(JSON.stringify(data)).build()
    record.bytes = toBase64(bytes); record.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
    expect(() => validateEquipmentOperationRecord(record)).toThrow()
  })
