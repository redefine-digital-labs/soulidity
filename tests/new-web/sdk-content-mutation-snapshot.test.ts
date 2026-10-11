import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { addAssertContentMutationScopeCalls, addAssertContentActiveBindingCalls, addAppendContentVersionAsOwnerCalls,
  addSetActiveContentCalls, buildSetActiveContentTx, buildClearActiveContentTx, buildDeleteContentVersionAsOwnerTx,
  buildDeleteContentVersionAsGrantedAgentTx, buildPurgeContentVersionAsOwnerTx } from '../../packages/soulidity-sdk/src/tx/content'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const deployment = { packageId: id(10), marketConfigId: id(11) }
const params = { contentObjectId: id(1), stateObjectId: id(2), kindRegistryObjectId: id(3), soulGrantObjectId: id(4),
  kind: 3, name: 'sprite', versionIndex: '9007199254740993', expectedOwnershipEpoch: '18446744073709551615',
  expectedActive: { name: 'prior', versionIndex: '9007199254740993' } }
const builders = [buildSetActiveContentTx, buildClearActiveContentTx, buildDeleteContentVersionAsOwnerTx,
  buildDeleteContentVersionAsGrantedAgentTx, buildPurgeContentVersionAsOwnerTx]
afterEach(() => vi.unstubAllEnvs())
function pure(tx: Transaction, command: number, argument: number) {
  const data = tx.getData(), ref = data.commands[command].MoveCall!.arguments[argument]
  if (ref.$kind !== 'Input' || data.inputs[ref.Input].$kind !== 'Pure') throw new Error('Expected pure input')
  return fromBase64(data.inputs[ref.Input].Pure!.bytes)
}

it.each(builders)('%s signs exact epoch and active before the mutation using captured deployment', build => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(99))
  const tx = build(params, deployment), calls = tx.getData().commands.map(c => c.MoveCall!)
  expect(calls).toHaveLength(3)
  expect(calls.slice(0, 2).map(c => c.function)).toEqual(['assert_mutation_scope', 'assert_active_binding'])
  expect(calls.every(c => c.package === deployment.packageId)).toBe(true)
  expect(bcs.u64().parse(pure(tx, 0, 2))).toBe(params.expectedOwnershipEpoch)
  expect(bcs.u32().parse(pure(tx, 1, 1))).toBe(3)
  expect(bcs.option(bcs.string()).parse(pure(tx, 1, 2))).toBe('prior')
  expect(bcs.option(bcs.u64()).parse(pure(tx, 1, 3))).toBe('9007199254740993')
})
it.each(builders)('%s uses canonical None options and snapshots caller binding', build => {
  const tx = build({ ...params, expectedActive: null }, deployment)
  expect(bcs.option(bcs.string()).parse(pure(tx, 1, 2))).toBe(null)
  expect(bcs.option(bcs.u64()).parse(pure(tx, 1, 3))).toBe(null)
  const expectedActive = { ...params.expectedActive }, other = build({ ...params, expectedActive }, deployment), before = other.getData()
  expectedActive.name = 'changed'; expectedActive.versionIndex = '0'
  expect(other.getData()).toEqual(before)
})
const badU64 = [undefined, null, true, {}, [], '', '01', '+1', ' 1', '1 ', '-1', '1e2', '1.0', '0x1',
  -1, -1n, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '18446744073709551616', 18446744073709551616n]
it.each(builders)('%s requires a canonical epoch and explicit valid active snapshot', build => {
  for (const value of badU64) expect(() => build({ ...params, expectedOwnershipEpoch: value as never }, deployment)).toThrow('expectedOwnershipEpoch')
  for (const value of [undefined, false, [], {}, { name: 'prior' }, { name: 'prior', versionIndex: '0', extra: 1 },
    { name: 'UPPER', versionIndex: '0' }, ...badU64.map(versionIndex => ({ name: 'prior', versionIndex }))]) {
    expect(() => build({ ...params, expectedActive: value as never }, deployment)).toThrow()
  }
})
it('both reusable helpers reject all malformed inputs before changing a caller PTB', () => {
  for (const expectedOwnershipEpoch of badU64) {
    const tx = new Transaction(), before = tx.getData()
    expect(() => addAssertContentMutationScopeCalls(tx, { ...params, expectedOwnershipEpoch: expectedOwnershipEpoch as never }, deployment)).toThrow()
    expect(tx.getData()).toEqual(before)
  }
  for (const changed of [{ contentObjectId: 'bad' }, { kind: -1 }, { kind: 4294967296 }, { kind: 1.1 },
    { expectedActive: undefined }, { expectedActive: { name: '', versionIndex: '0' } },
    { expectedActive: { name: 'prior', versionIndex: '01' } }]) {
    const tx = new Transaction(), before = tx.getData()
    expect(() => addAssertContentActiveBindingCalls(tx, { ...params, ...changed } as never, deployment)).toThrow()
    expect(tx.getData()).toEqual(before)
  }
  for (const changed of [{ contentObjectId: 'bad' }, { stateObjectId: 'bad' }]) {
    const tx = new Transaction(), before = tx.getData()
    expect(() => addAssertContentMutationScopeCalls(tx, { ...params, ...changed }, deployment)).toThrow()
    expect(tx.getData()).toEqual(before)
  }
  for (const add of [addAssertContentMutationScopeCalls, addAssertContentActiveBindingCalls]) {
    const tx = new Transaction(), before = tx.getData()
    expect(() => add(tx, params, { packageId: 'bad' })).toThrow()
    expect(tx.getData()).toEqual(before)
  }
})
it('epoch-only guard composes with append and active using the actual shifted Result', () => {
  const tx = new Transaction()
  addAssertContentMutationScopeCalls(tx, params, deployment)
  const versionIndex = addAppendContentVersionAsOwnerCalls(tx, { ...params, slotReadModeMask: 3, downloadPolicy: 'owner_only',
    expectedVersionIndex: '0', encryptedEnvelope: new Uint8Array([1]), contentBlobObjectId: id(5) }, deployment)
  addSetActiveContentCalls(tx, { ...params, versionIndex }, deployment)
  expect(tx.getData().commands.map(c => c.MoveCall!.function)).toEqual(['assert_mutation_scope', 'append_version_as_owner', 'set_active_content_v2'])
  expect(tx.getData().commands[2].MoveCall!.arguments[6]).toMatchObject({ Result: 1 })
})
