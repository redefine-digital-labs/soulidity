import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction,TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { appendSelectAnimacraftPackStyleV8, beginAnimacraftEquipmentV8Update, finishAnimacraftEquipmentV8Update } from '@soulidity/sdk'
import { validateEquipmentOperationRecord,type EquipmentOperation } from '../../web/lib/animacraft/equipment-operation'
import { equipmentOperationFixture,eid,release } from './fixtures/equipment-operation'
const selection = { baseRegistryId: eid(85),releaseId: eid(301),passId: eid(302),partKey: 'body',itemKey: 'ribbon',styleKey: 'gold',swatchKey: 'red' }
const source = { makerRootId: eid(10),definitionRegistryId: eid(81),packRegistryId: eid(82),makerAccessPassId: eid(83),paymentCoinType: `${eid(2)}::sui::SUI` }
it('encodes the native Pack ABI, with a distinct owned Pack pass and explicit swatch', () => {
  const tx = new Transaction()
  const scope = { target: release,soulStateId: eid(14),equipmentId: eid(80),expectedRevision: '9007199254740993' }
  const update = beginAnimacraftEquipmentV8Update(tx,scope)
  appendSelectAnimacraftPackStyleV8(tx,{ ...scope,update,source,selection })
  finishAnimacraftEquipmentV8Update(tx,{...scope,update,definitionRegistryId:source.definitionRegistryId,baseRegistryId:selection.baseRegistryId})
  const data = tx.getData(); const call = data.commands[1].MoveCall!
  const input = (n: number) => data.inputs[call.arguments[n].Input!]
  expect(call.function).toBe('select_pack_v8'); expect(call.arguments).toHaveLength(15)
  expect(call.arguments[0]).toMatchObject({Result:0})
  expect(Array.from({length:8},(_,i) => input(i+1).UnresolvedObject!.objectId))
    .toEqual([eid(80),eid(10),eid(81),eid(82),eid(85),eid(301),eid(302),eid(83)])
  expect(bcs.u64().fromBase64(input(9).Pure!.bytes)).toBe('9007199254740993')
  expect(bcs.option(bcs.u64()).fromBase64(input(10).Pure!.bytes)).toBeNull()
  expect([11,12,13].map(n => bcs.string().fromBase64(input(n).Pure!.bytes))).toEqual(['body','ribbon','gold'])
  expect(bcs.option(bcs.string()).fromBase64(input(14).Pure!.bytes)).toBe('red')
  expect(data.commands.flatMap(c=>c.MoveCall?[c.MoveCall.function]:[])).toEqual(['begin_update_v8','select_pack_v8','finish_update_v8'])
})
it.each(['passId','releaseId','baseRegistryId','partKey','itemKey','styleKey','swatchKey'] as const)('rejects invalid Pack %s before appending', field => {
  for (const value of ['',...(field.endsWith('Key') ? ['bad/key','bad\0key','界'.repeat(43)] : [eid(0),'0x1'])]) {
    const tx = new Transaction()
    const scope = { target: release,soulStateId: eid(14),equipmentId: eid(80),expectedRevision: '1' }
    const update = beginAnimacraftEquipmentV8Update(tx,scope)
    expect(() => appendSelectAnimacraftPackStyleV8(tx,{ ...scope,source,update,
      selection: { ...selection,[field]: value } })).toThrow()
    expect(tx.getData().commands).toHaveLength(1)
  }
})
const operations: EquipmentOperation[] = [ { kind: 'select-pack',selection },
  ...([{ kind: 'base',itemId: eid(84) },{ kind: 'external',itemId: eid(102) },{ kind: 'selection',selectionIndex: '0' }] as const)
    .map(replaces => ({ kind: 'select-pack' as const,selection,replaces })) ]
it.each(operations)('validates Pack $replaces.kind atomic operation exact bytes', async operation => {
  const { record,tx } = await equipmentOperationFixture(operation)
  expect(validateEquipmentOperationRecord(record)).toBe(record)
  const data = tx.getData(); const call = data.commands.at(-3)!.MoveCall!
  expect(data.commands[0].MoveCall!.function).toBe('begin_update_v8')
  expect(data.commands.at(-1)!.MoveCall!.function).toBe('finish_update_v8')
  expect(call.function).toBe('select_pack_v8')
  expect(bcs.u64().fromBase64(data.inputs[call.arguments[9].Input!].Pure!.bytes))
    .toBe('replaces' in operation && operation.replaces ? '2' : '1')
  expect(data.inputs[call.arguments[7].Input!].Object!.ImmOrOwnedObject!.objectId).toBe(selection.passId)
})
it.each(['pass','release','part','item','style','swatch','revision','pass-shared','release-mutable','raw-runtime','extra-command'])
  ('rejects altered Pack %s even with a new digest', async problem => {
    const { record,tx } = await equipmentOperationFixture(operations[1])
    const data = tx.getData(); const call = data.commands.at(-3)!.MoveCall!
    const input = (n: number) => data.inputs[call.arguments[n].Input!]
    if (problem === 'pass') input(7).Object!.ImmOrOwnedObject!.objectId = eid(999)
    if (problem === 'release') input(6).Object!.SharedObject!.objectId = eid(999)
    if (problem === 'pass-shared') input(7).Object = { SharedObject: {objectId: selection.passId,initialSharedVersion: '1',mutable: false} } as any
    if (problem === 'release-mutable') input(6).Object!.SharedObject!.mutable = true
    if (problem === 'revision') input(9).Pure!.bytes = toBase64(bcs.u64().serialize('1').toBytes())
    if (['part','item','style'].includes(problem)) input({part:11,item:12,style:13}[problem]!).Pure!.bytes = toBase64(bcs.string().serialize('other').toBytes())
    if (problem === 'swatch') input(14).Pure!.bytes = toBase64(bcs.option(bcs.string()).serialize(null).toBytes())
    if (problem === 'raw-runtime') { call.package = eid(71);call.module = 'runtime_v8';call.function = 'select_pack_style_v8' }
    if (problem === 'extra-command') data.commands.push(structuredClone(data.commands[0]))
    const bytes = await Transaction.from(JSON.stringify(data)).build()
    record.bytes = toBase64(bytes); record.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
    expect(() => validateEquipmentOperationRecord(record)).toThrow()
  })
