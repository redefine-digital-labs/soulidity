import { expect, it, vi } from 'vitest'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { equipmentOperationFixture, eid, signer } from './fixtures/equipment-operation'
import { runEquipmentOperation, validateEquipmentOperationRecord, type EquipmentOperationAdapter,
  type EquipmentOperation, type EquipmentOperationRecord, type EquipmentOperationStore } from '../../web/lib/animacraft/equipment-operation'
const rejected = () => Object.assign(new Error('rejected'), { name: 'WalletStandardError', context: { __code: 4001000 } })
const attachedProofSources = [201, 202].map(n => ({ releaseId: eid(n), paymentCoinType: `${eid(2)}::sui::SUI`,
  definitionCommitment: 'ab'.repeat(32) }))
it('builds final-revision Pack proofs after mutations and passes every proof to the final guard', async () => {
  const { record, tx } = await equipmentOperationFixture({ kind: 'clear-selection', selectionIndex: '0' }, attachedProofSources)
  expect(validateEquipmentOperationRecord(record)).toBe(record)
  const commands = tx.getData().commands
  expect(commands.map(command => command.MoveCall?.function ?? command.$kind)).toEqual([
    'begin_update_v8', 'clear_selection_v8', 'prove_equipment_pack_definitions_v8',
    'prove_equipment_pack_definitions_v8', 'MakeMoveVec', 'finish_update_v8',
  ])
  expect(commands[2].MoveCall?.package).toBe(eid(71))
  expect(commands[2].MoveCall?.typeArguments).toEqual([`${eid(2)}::sui::SUI`])
  expect(commands[4].MakeMoveVec?.elements).toEqual([{ $kind: 'Result', Result: 2 }, { $kind: 'Result', Result: 3 }])
  expect(commands[5].MoveCall?.arguments[3]).toEqual({ $kind: 'Result', Result: 4 })
})
it.each(['order', 'omit', 'foreign-proof', 'early-proof', 'duplicate-source', 'wrong-coin'])
('rejects altered attached proof %s in recovered transaction bytes', async problem => {
  const { record, tx } = await equipmentOperationFixture({ kind: 'clear-selection', selectionIndex: '0' }, structuredClone(attachedProofSources))
  const data = tx.getData()
  if (problem === 'order') record.updateSource!.packDefinitions!.reverse()
  if (problem === 'omit') data.commands[4].MakeMoveVec!.elements.pop()
  if (problem === 'foreign-proof') data.commands[4].MakeMoveVec!.elements[0] = { $kind: 'Result', Result: 0 }
  if (problem === 'early-proof') [data.commands[1], data.commands[2]] = [data.commands[2], data.commands[1]]
  if (problem === 'duplicate-source') record.updateSource!.packDefinitions![1] = record.updateSource!.packDefinitions![0]
  if (problem === 'wrong-coin') record.updateSource!.packDefinitions![0].paymentCoinType = `${eid(2)}::other::Coin`
  const bytes = await Transaction.from(JSON.stringify(data)).build()
  record.bytes = toBase64(bytes); record.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  expect(() => validateEquipmentOperationRecord(record)).toThrow()
})
async function fixture(operation?: EquipmentOperation) {
  const { record } = await equipmentOperationFixture(operation); const events: string[] = []; let saved: EquipmentOperationRecord | null = null
  let locked = false
  const store: EquipmentOperationStore = {
    exclusive: async (_key, work) => { if (locked) throw new Error('busy'); locked = true; try { return await work() } finally { locked = false } },
    read: () => structuredClone(saved), write: (_key, value) => { events.push(`save:${value.phase}`); saved = structuredClone(value) },
  }
  let submitted = false
  const adapter: EquipmentOperationAdapter = {
    prepare: vi.fn(async () => { events.push('prepare'); return structuredClone(record) }),
    query: vi.fn(async () => { events.push('query'); return submitted ? 'SUCCEEDED' : 'MISSING' }),
    preflight: vi.fn(async () => { events.push('preflight') }),
    sign: vi.fn(async r => { events.push('sign'); return signer.signTransaction(fromBase64(r.bytes)) }),
    verifySignature: async r => { await verifyTransactionSignature(fromBase64(r.bytes), r.signature!, { address: r.owner }) },
    broadcast: vi.fn(async () => { events.push('broadcast'); submitted = true }),
    readback: vi.fn(async () => { events.push('readback') }),
  }
  const run = (operation = false, queryOnly = false) => runEquipmentOperation({ soulId: record.soulId, owner: record.owner,
    ...(operation ? { operation: record.operation } : {}), queryOnly, store, adapter })
  return { record, events, store, adapter, run, saved: () => saved }
}
it.each(['unequip-base','unequip-external','close'] as const)('validates actual %s SDK transaction bytes', async kind => {
  const { record } = await equipmentOperationFixture(kind === 'close' ? { kind } : { kind, itemId: eid(84) })
  expect(validateEquipmentOperationRecord(record)).toBe(record)
})
it('persists exact bytes before signing and signature before broadcast, then requires ledger and readback', async () => {
  const f = await fixture(); const result = await f.run(true)
  expect(result.phase).toBe('SUCCEEDED')
  expect(f.events).toEqual(['prepare','save:PREPARED','query','preflight','save:SIGNING','sign','save:SIGNED','preflight','broadcast','query','readback','save:SUCCEEDED'])
})
it('refuses to sign when prepared storage fails', async () => {
  const f = await fixture(); f.store.write = () => { throw new Error('quota') }
  await expect(f.run(true)).rejects.toThrow('quota'); expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('refuses to broadcast if signature persistence fails, then resumes the SAME prepared bytes', async () => {
  const f = await fixture(); const write = f.store.write
  f.store.write = (key, r) => { if (r.phase === 'SIGNED') throw new Error('quota'); write(key,r) }
  await expect(f.run(true)).rejects.toThrow('quota'); expect(f.adapter.broadcast).not.toHaveBeenCalled()
  expect(f.saved()?.phase).toBe('SIGNING'); f.store.write = write
  expect((await f.run()).phase).toBe('SUCCEEDED'); expect(f.adapter.prepare).toHaveBeenCalledTimes(1)
  expect(f.saved()?.bytes).toBe(f.record.bytes)
})
it('preserves rejected signatures as a recoverable prepared operation', async () => {
  const f = await fixture(); vi.mocked(f.adapter.sign).mockRejectedValueOnce(rejected())
  await expect(f.run(true)).rejects.toThrow('rejected'); expect(f.saved()?.phase).toBe('PREPARED')
  await expect(f.run(true)).rejects.toThrow('Recover the pending'); expect(f.adapter.broadcast).not.toHaveBeenCalled()
  expect((await f.run()).phase).toBe('SUCCEEDED')
})
it('rejects wallet-modified bytes and wrong-address signatures without broadcasting', async () => {
  const f = await fixture(); vi.mocked(f.adapter.sign).mockResolvedValueOnce({ bytes: 'AAAA', signature: 'bad' })
  await expect(f.run(true)).rejects.toThrow('Wallet changed'); expect(f.saved()?.phase).toBe('SIGNING')
  vi.mocked(f.adapter.sign).mockResolvedValueOnce({ bytes: f.record.bytes, signature: 'bad' })
  await expect(f.run()).rejects.toThrow(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it.each<EquipmentOperation | undefined>([undefined, { kind: 'attach-pack', pack: { releaseId: eid(202), passId: eid(201) },
  attachment: { definitionCommitment: 'ab'.repeat(32), additionalSlots: 0 } }])
('queries first after unknown broadcast; never prepares or signs again: %j', async operation => {
  const f = await fixture(operation); vi.mocked(f.adapter.broadcast).mockRejectedValueOnce(new Error('timeout'))
  await expect(f.run(true)).rejects.toThrow('timeout'); const signed = f.saved()
  expect(signed?.phase).toBe('SIGNED'); f.events.length = 0
  expect((await f.run()).phase).toBe('SUCCEEDED')
  expect(f.events[0]).toBe('query'); expect(f.adapter.sign).toHaveBeenCalledTimes(1); expect(f.adapter.prepare).toHaveBeenCalledTimes(1)
  expect(f.saved()?.bytes).toBe(signed?.bytes); expect(f.saved()?.signature).toBe(signed?.signature)
})
it('does not sign or broadcast on query outage, query-only recovery or pending checkpoint', async () => {
  const f = await fixture(); vi.mocked(f.adapter.query).mockRejectedValueOnce(new Error('offline'))
  await expect(f.run(true)).rejects.toThrow('offline'); expect(f.saved()?.phase).toBe('PREPARED')
  await f.run(false,true); vi.mocked(f.adapter.query).mockResolvedValueOnce('PENDING'); await f.run()
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('requires successful readback before persisting success; a retry only queries', async () => {
  const f = await fixture(); vi.mocked(f.adapter.readback).mockRejectedValueOnce(new Error('readback offline'))
  await expect(f.run(true)).rejects.toThrow('readback offline'); expect(f.saved()?.phase).toBe('SIGNED')
  await f.run(); expect(f.adapter.broadcast).toHaveBeenCalledTimes(1); expect(f.saved()?.phase).toBe('SUCCEEDED')
})
it('records only verified execution failure as terminal', async () => {
  const f = await fixture(); vi.mocked(f.adapter.query).mockResolvedValueOnce('MISSING').mockResolvedValueOnce('FAILED')
  expect((await f.run(true)).phase).toBe('FAILED'); expect(f.adapter.readback).not.toHaveBeenCalled()
})
it('allows explicit cancellation only before a signature was persisted', async () => {
  const f = await fixture(); vi.mocked(f.adapter.sign).mockRejectedValueOnce(rejected())
  await expect(f.run(true)).rejects.toThrow('rejected')
  const cancelled = await runEquipmentOperation({ soulId: f.record.soulId, owner: f.record.owner,
    store: f.store, adapter: f.adapter, cancelUnsigned: true })
  expect(cancelled.phase).toBe('CANCELLED'); expect(f.adapter.broadcast).not.toHaveBeenCalled()
  expect((await f.run(true)).phase).toBe('SUCCEEDED')
})
it('will not discard an unknown signed operation or trust a forged terminal phase', async () => {
  const f = await fixture(); vi.mocked(f.adapter.broadcast).mockRejectedValueOnce(new Error('timeout'))
  await expect(f.run(true)).rejects.toThrow('timeout')
  await expect(runEquipmentOperation({ soulId: f.record.soulId, owner: f.record.owner,
    store: f.store, adapter: f.adapter, cancelUnsigned: true })).rejects.toThrow('cannot be discarded')
  f.store.write('fixture', { ...f.saved()!, phase: 'SUCCEEDED' })
  await expect(f.run(true)).rejects.toThrow('must be confirmed')
})
it('persists SIGNING before entering the wallet; unknown signing cannot later be discarded', async () => {
  const f = await fixture(); vi.mocked(f.adapter.sign).mockRejectedValueOnce(new Error('wallet disconnected'))
  await expect(f.run(true)).rejects.toThrow('disconnected'); expect(f.saved()?.phase).toBe('SIGNING')
  await expect(runEquipmentOperation({ soulId: f.record.soulId, owner: f.record.owner, store: f.store,
    adapter: f.adapter, cancelUnsigned: true })).rejects.toThrow('cannot be discarded')
  vi.mocked(f.adapter.sign).mockRejectedValueOnce(rejected())
  await expect(f.run()).rejects.toThrow('rejected'); expect(f.saved()?.phase).toBe('SIGNING')
  expect((await f.run()).phase).toBe('SUCCEEDED'); expect(f.adapter.prepare).toHaveBeenCalledTimes(1)
})
it('blocks simultaneous operations in another tab while signing', async () => {
  const f = await fixture(); let finish!: () => void; let ready!: () => void
  const started = new Promise<void>(resolve => { ready = resolve })
  vi.mocked(f.adapter.sign).mockImplementationOnce(async r => { ready(); await new Promise<void>(resolve => { finish = resolve }); return signer.signTransaction(fromBase64(r.bytes)) })
  const pending = f.run(true); await started
  await expect(f.run(true)).rejects.toThrow('busy'); finish(); await pending
  expect(f.adapter.sign).toHaveBeenCalledTimes(1)
})
it.each(['digest','owner','revision','operation','extra-command','package','expiry','trailing-bytes'])('rejects altered persisted %s', async problem => {
  const { record } = await equipmentOperationFixture(); const r = structuredClone(record)
  if (problem === 'digest') r.digest = 'bad'
  if (problem === 'owner') r.owner = eid(999)
  if (problem === 'revision') r.revision = '2'
  if (problem === 'operation') r.operation = { kind: 'close' }
  if (problem === 'package') r.release.soulidityCallablePackageId = eid(999)
  if (problem === 'expiry') r.expirationEpoch = '11'
  if (problem === 'trailing-bytes') { r.bytes = toBase64(new Uint8Array([...fromBase64(r.bytes),0])); r.digest = TransactionDataBuilder.getDigestFromBytes(fromBase64(r.bytes)) }
  if (problem === 'extra-command') {
    const tx = Transaction.from(fromBase64(r.bytes)); tx.moveCall({ target: `${eid(5)}::extra::unexpected`, arguments: [] })
    const bytes = await tx.build(); r.bytes = toBase64(bytes); r.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  }
  expect(() => validateEquipmentOperationRecord(r)).toThrow()
})

it.each(['missing-begin', 'missing-finish', 'wrong-mutation-guard', 'wrong-finish-guard', 'duplicate-finish',
  'changed-definitions', 'changed-base', 'guard-as-input', 'early-finish', 'missing-source', 'proof-type', 'proof-elements'])
('rejects %s in saved guarded bytes even after digest recomputation', async problem => {
  const { record, tx } = await equipmentOperationFixture()
  const data = tx.getData()
  if (problem === 'missing-source') delete record.updateSource
  if (problem === 'changed-definitions') record.updateSource!.definitionRegistryId = eid(998)
  if (problem === 'changed-base') record.updateSource!.baseRegistryId = eid(999)
  if (problem === 'missing-begin') data.commands.shift()
  if (problem === 'missing-finish') data.commands.pop()
  if (problem === 'duplicate-finish') data.commands.push(structuredClone(data.commands.at(-1)!))
  if (problem === 'early-finish') [data.commands[1], data.commands[2]] = [data.commands[2], data.commands[1]]
  if (problem === 'wrong-mutation-guard') data.commands[1].MoveCall!.arguments[0] = { $kind: 'Result', Result: 1 }
  if (problem === 'wrong-finish-guard') data.commands[3].MoveCall!.arguments[4] = { $kind: 'Result', Result: 1 }
  if (problem === 'proof-type') data.commands[2].MakeMoveVec!.type = `${eid(99)}::runtime_v8::PackDefinitionProofV8`
  if (problem === 'proof-elements') data.commands[2].MakeMoveVec!.elements = [{ $kind: 'Result', Result: 0 }]
  if (problem === 'guard-as-input') data.commands[1].MoveCall!.arguments[0] = structuredClone(data.commands[0].MoveCall!.arguments[0])
  const bytes = await Transaction.from(JSON.stringify(data)).build()
  record.bytes = toBase64(bytes); record.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  expect(() => validateEquipmentOperationRecord(record)).toThrow()
})
