import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'
import { Transaction } from '@mysten/sui/transactions'
import { addSetActiveContentCalls, buildSetActiveContentTx, buildDeleteContentVersionAsOwnerTx,
  buildDeleteContentVersionAsGrantedAgentTx, buildPurgeContentVersionAsOwnerTx } from '../../packages/soulidity-sdk/src/tx/content'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const params = { contentObjectId: id(1), stateObjectId: id(2), kindRegistryObjectId: id(3),
  soulGrantObjectId: id(4), kind: 2, name: 'skill', expectedOwnershipEpoch: '0', expectedActive: null }
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(10))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', id(11))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID', id(3))
})
afterEach(() => { vi.unstubAllEnvs() })
const builders = [
  ['delete-owner', buildDeleteContentVersionAsOwnerTx, 'content', 'delete_version_as_owner', 5],
  ['delete-grantee', buildDeleteContentVersionAsGrantedAgentTx, 'content', 'delete_version_as_granted_agent', 6],
  ['purge-owner', buildPurgeContentVersionAsOwnerTx, 'content', 'purge_deleted_version_as_owner', 5],
  ['set-active', buildSetActiveContentTx, 'market', 'set_active_content_v2', 6],
] as const

it.each(builders)('%s encodes exact u64 literals without narrowing to Number', (_label, build, module, name, indexPosition) => {
  for (const value of [0, 1, Number.MAX_SAFE_INTEGER, 0n, 9007199254740993n, 18446744073709551615n,
    '0', '9007199254740993', '18446744073709551615']) {
    const data = build({ ...params, versionIndex: value }).getData()
    expect(data.commands).toHaveLength(3)
    const command = data.commands[2].MoveCall!
    expect(command).toMatchObject({ package: id(10), module, function: name, typeArguments: [] })
    const argument = command.arguments[indexPosition]
    expect(argument.$kind).toBe('Input')
    if (argument.$kind !== 'Input') throw new Error('Expected pure index input')
    const input = data.inputs[argument.Input]
    expect(input.$kind).toBe('Pure')
    if (input.$kind !== 'Pure') throw new Error('Expected pure index bytes')
    expect(bcs.u64().parse(fromBase64(input.Pure.bytes))).toBe(String(value))
  }
})

it.each(builders)('%s preserves safe-number/bigint transaction byte equality', (_label, build) => {
  for (const value of [0, 1, 128, Number.MAX_SAFE_INTEGER]) {
    expect(build({ ...params, versionIndex: value }).getData())
      .toEqual(build({ ...params, versionIndex: BigInt(value) }).getData())
  }
})

it.each(builders)('%s rejects unsafe/negative/fractional/nonfinite/overflow indices', (_label, build) => {
  for (const value of [-1, -1n, 0.5, Number.MAX_SAFE_INTEGER + 1, Number(9007199254740993n), NaN,
    Infinity, -Infinity, 18446744073709551616n]) {
    expect(() => build({ ...params, versionIndex: value })).toThrow('Content versionIndex')
  }
})

it.each(builders.slice(0, 3))('%s rejects runtime nonnumeric values instead of coercing them', (_label, build) => {
  for (const value of ['', '00', '01', '+1', '-1', ' 1', '1 ', '1e3', '0x1', '1.0', '18446744073709551616', null, undefined, true, {}, []]) {
    expect(() => build({ ...params, versionIndex: value as never })).toThrow('Content versionIndex')
  }
})

it('set-active composition retains the actual preceding Move result as an argument', () => {
  const tx = new Transaction()
  const index = tx.moveCall({ target: `${id(10)}::content::append_version_as_owner`, arguments: [] })
  addSetActiveContentCalls(tx, { ...params, versionIndex: index })
  const data = tx.getData()
  expect(data.commands).toHaveLength(2)
  expect(data.commands[1].MoveCall!.arguments[6]).toMatchObject({ $kind: 'Result', Result: 0 })
})

it('set-active rejects invalid literals before mutating the caller transaction', () => {
  for (const value of [-1, -1n, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, 18446744073709551616n]) {
    const tx = new Transaction(), before = tx.getData()
    expect(() => addSetActiveContentCalls(tx, { ...params, versionIndex: value })).toThrow('Content versionIndex')
    expect(tx.getData()).toEqual(before)
  }
})
