import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { validateEquipmentOperationRecord, type EquipmentOperation } from '../../web/lib/animacraft/equipment-operation'
import { equipmentOperationFixture, eid } from './fixtures/equipment-operation'

const protection = { sealRegistryId: eid(87), sealPolicyId: eid(203),
  ciphertextBlobCommitment: Array(32).fill(11), certificationCommitment: Array(32).fill(12), sealId: Array(32).fill(13) }
const item = { kind: 'base' as const,itemId: eid(84),baseRegistryId: eid(85),styleKey: 'red',swatchKey: 'red',protection }
const selection = { baseRegistryId: eid(85),partKey: 'body',itemKey: 'hat',styleKey: 'red',swatchKey: 'red',protection }
const operations: EquipmentOperation[] = [
  { kind: 'equip',item }, { kind: 'equip',item,replaces: { kind: 'selection',selectionIndex: '0' } },
  { kind: 'equip',item,replaces: { kind: 'base',itemId: eid(84) } },
  { kind: 'select-base',selection }, { kind: 'select-base',selection,replaces: { kind: 'base',itemId: eid(84) } },
  { kind: 'select-base',selection,replaces: { kind: 'selection',selectionIndex: '0' } },
]
it.each(operations)('accepts exact protected $kind $replaces.kind persisted SDK bytes', async operation => {
  const { record,tx } = await equipmentOperationFixture(operation)
  expect(validateEquipmentOperationRecord(record)).toBe(record)
  const data = tx.getData(); const call = data.commands.at(-3)!.MoveCall!
  expect(data.commands[0].MoveCall!.function).toBe('begin_update_v8')
  expect(data.commands.at(-1)!.MoveCall!.function).toBe('finish_update_v8')
  expect(call.function).toBe(operation.kind === 'equip' ? 'equip_protected_base_v8' : 'select_protected_base_v8')
  const revisionArg = operation.kind === 'equip' ? 8 : 7
  expect(bcs.u64().fromBase64(data.inputs[call.arguments[revisionArg].Input!].Pure!.bytes))
    .toBe('replaces' in operation && operation.replaces ? '2' : '1')
})
it.each(['owned','selection'] as const)('rejects each changed %s protected argument even with a recomputed transaction digest', async kind => {
  for (const change of ['registry','policy','blob','certification','seal-id','mutable','public-fallback','wrong-record'] as const) {
    const operation: EquipmentOperation = kind === 'owned' ? { kind: 'equip',item: structuredClone(item) }
      : { kind: 'select-base',selection: structuredClone(selection) }
    const { record,tx } = await equipmentOperationFixture(operation)
    const data = tx.getData(); const call = data.commands.at(-3)!.MoveCall!; const offset = kind === 'owned' ? 12 : 13
    const indices = { registry: 0,policy: 1,blob: 2,certification: 3,'seal-id': 4 }
    if (change in indices) {
      const index = indices[change as keyof typeof indices]
      const input = data.inputs[call.arguments[offset+index].Input!]
      if (index < 2) input.Object!.SharedObject!.objectId = eid(999)
      else input.Pure!.bytes = toBase64(bcs.vector(bcs.u8()).serialize(Array(32).fill(99)).toBytes())
    } else if (change === 'mutable') data.inputs[call.arguments[offset].Input!].Object!.SharedObject!.mutable = true
    else if (change === 'public-fallback') call.function = kind === 'owned' ? 'equip_base_v8' : 'select_base_v8'
    else {
      const proof = record.operation.kind === 'equip' && record.operation.item.kind === 'base'
        ? record.operation.item.protection! : (record.operation as Extract<EquipmentOperation,{ kind: 'select-base' }>).selection.protection!
      proof.sealId = Array(32).fill(99)
    }
    const bytes = await Transaction.from(JSON.stringify(data)).build()
    record.bytes = toBase64(bytes); record.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
    expect(() => validateEquipmentOperationRecord(record), change).toThrow()
  }
})
