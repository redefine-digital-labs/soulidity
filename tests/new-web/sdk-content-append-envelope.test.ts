import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64, fromHex, toHex } from '@mysten/sui/utils'
import { Transaction } from '@mysten/sui/transactions'
import { addAppendContentVersionAsOwnerCalls, addAppendContentVersionAsGrantedAgentCalls,
  buildAppendContentVersionAsOwnerTx, buildAppendContentVersionAsGrantedAgentTx, addSetActiveContentCalls } from '../../packages/soulidity-sdk/src/tx/content'
import { deriveContentUploadRecoveryId, assertContentUploadRecoveryId, CONTENT_UPLOAD_RECOVERY_ID_BYTES } from '../../packages/soulidity-sdk/src/content-upload-recovery-id'
import { contentEnvelopeKey } from '../../web/lib/soulidity/content-envelope'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const params = { contentObjectId: id(1), stateObjectId: id(2), kindRegistryObjectId: id(3), soulGrantObjectId: id(4),
  kind: 3, name: 'sprite', slotReadModeMask: 3, downloadPolicy: 'owner_only' as const, contentBlobObjectId: id(5),
  expectedVersionIndex: '9007199254740993', encryptedEnvelope: new Uint8Array([0, 128, 255]) }
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(10))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', id(11))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID', id(3))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const builders = [
  ['owner', buildAppendContentVersionAsOwnerTx, addAppendContentVersionAsOwnerCalls, 'append_version_as_owner', 7],
  ['grantee', buildAppendContentVersionAsGrantedAgentTx, addAppendContentVersionAsGrantedAgentCalls, 'append_version_as_granted_agent', 8],
] as const
function pure(tx: Transaction, position: number): Uint8Array {
  const data = tx.getData(), arg = data.commands[0].MoveCall!.arguments[position]
  if (arg.$kind !== 'Input') throw new Error('Expected actual pure input')
  const input = data.inputs[arg.Input]
  if (input.$kind !== 'Pure') throw new Error('Expected BCS bytes')
  return fromBase64(input.Pure.bytes)
}
it.each(builders)('%s uses the sole current ABI, exact u64/envelope before Blob', (_role, build, _add, name, index) => {
  const tx = build(params), call = tx.getData().commands[0].MoveCall!
  expect(call).toMatchObject({ package: id(10), module: 'content', function: name, typeArguments: [] })
  expect(call.arguments).toHaveLength(index + 4)
  expect(bcs.u64().parse(pure(tx, index))).toBe('9007199254740993')
  expect(bcs.vector(bcs.u8()).parse(pure(tx, index + 1))).toEqual([0, 128, 255])
  const data = tx.getData()
  for (const [pos, objectId] of [[0, id(1)], [1, id(2)], [2, id(3)], [index + 2, id(5)], [index + 3, id(6)]] as const) {
    const arg = call.arguments[pos]; if (arg.$kind !== 'Input') throw new Error('Expected object input')
    expect(data.inputs[arg.Input]).toMatchObject({ UnresolvedObject: { objectId } })
  }
  const source = readFileSync('move/soulidity/sources/content.move', 'utf8')
  const signature = source.slice(source.indexOf(`public fun ${name}(`)).split('): u64')[0]
  expect(signature).toContain('state: &mut SoulState')
  expect(signature).toMatch(/download_policy: u8,\s+expected_version_index: u64,\s+encrypted_envelope: vector<u8>,\s+content_blob: Blob/)
})
it.each(builders)('%s preserves safe-number/bigint/canonical-string byte equality', (_role, build) => {
  for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
    expect(build({ ...params, expectedVersionIndex: value }).getData()).toEqual(build({ ...params, expectedVersionIndex: String(value) }).getData())
    expect(build({ ...params, expectedVersionIndex: BigInt(value) }).getData()).toEqual(build({ ...params, expectedVersionIndex: String(value) }).getData())
  }
})
it.each(builders)('%s rejects malformed CAS values without mutating the caller transaction', (_role, _build, add) => {
  for (const expectedVersionIndex of [undefined, null, true, {}, [], '', '01', '+1', ' 1', '1 ', '-1', '1e2', '1.0', '0x1',
    -1, -1n, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '18446744073709551616', 18446744073709551616n]) {
    const tx = new Transaction(), before = tx.getData()
    expect(() => add(tx, { ...params, expectedVersionIndex: expectedVersionIndex as never })).toThrow('Content versionIndex')
    expect(tx.getData()).toEqual(before)
  }
})
it.each(builders)('%s requires bounded byte envelopes and never inserts a missing placeholder', (_role, _build, add) => {
  for (const encryptedEnvelope of [undefined, null, '', 'encrypted', [1], new Uint8Array(), new Uint8Array(65537)]) {
    const tx = new Transaction(), before = tx.getData()
    expect(() => add(tx, { ...params, encryptedEnvelope: encryptedEnvelope as never })).toThrow('Content encryptedEnvelope')
    expect(tx.getData()).toEqual(before)
  }
})
it.each(builders)('%s snapshots exact max-envelope bytes and accepts full u64', (_role, build, _add, _name, index) => {
  const encryptedEnvelope = Uint8Array.from({ length: 65536 }, (_, i) => i % 256)
  const tx = build({ ...params, expectedVersionIndex: '18446744073709551615', encryptedEnvelope }), before = tx.getData()
  encryptedEnvelope.fill(0)
  expect(tx.getData()).toEqual(before)
  expect(bcs.u64().parse(pure(tx, index))).toBe('18446744073709551615')
  expect(bcs.vector(bcs.u8()).parse(pure(tx, index + 1))).toEqual(Array.from({ length: 65536 }, (_, i) => i % 256))
})
it.each(builders)('%s can still chain the returned append index into set-active', (_role, _build, add) => {
  const tx = new Transaction(), index = add(tx, params)
  addSetActiveContentCalls(tx, { ...params, versionIndex: index })
  expect(tx.getData().commands[1].MoveCall!.arguments[6]).toMatchObject({ Result: 0 })
})

const vectors = [
  ['0', '0000000000000000', '0e133af35791e5cbcf842846f40481e538ab6e3b326eaf1dedb1650c401bf0e2'],
  ['9007199254740993', '0100000000002000', 'f6849109fc2335b07be8622193557d1f9c1e1083bc45e6e06a8bfbe0c114d1af'],
  ['18446744073709551615', 'ffffffffffffffff', '9acff86596ab185342da93c4015a1cdae818c0b45fc7bd680e3703d01bcc1024'],
] as const
it.each(vectors)('browser key matches Move fixed golden version %s', (versionIndex, indexBytes, digest) => {
  const contentObjectId = '0x' + '1234567890abcdef'.repeat(4), name = 'sprite_test-01'
  const codec = bcs.struct('Independent', { content: bcs.Address, kind: bcs.u32(), name: bcs.string(), version: bcs.u64() })
  expect(toHex(codec.serialize({ content: contentObjectId, kind: 3, name, version: versionIndex }).toBytes()))
    .toBe('1234567890abcdef'.repeat(4) + '030000000e7370726974655f746573742d3031' + indexBytes)
  const key = `content_seal_envelope_v1:${digest}`
  expect(contentEnvelopeKey({ contentObjectId, kind: 3, name, versionIndex, blobObjectId: id(50) })).toBe(key)
  expect(readFileSync('move/soulidity/sources/content_envelope_tests.move', 'utf8')).toContain(key)
  const source = readFileSync('move/soulidity/sources/content.move', 'utf8')
  expect(source).toMatch(/struct ContentEnvelopeKeyV1 has drop\s*{\s*content: ID,\s*kind: u32,\s*name: String,\s*version: u64,/)
})

const recovery = { author: id(0x11), contentObjectId: id(0x22), operationHash: '33'.repeat(32), nonce: '44'.repeat(16) }
const recoveryGolden = '736f756c2d636f6e74656e742d75706c6f61642d7265636f766572793a01'
  + '11'.padStart(64, '0') + '22'.padStart(64, '0') + '33'.repeat(32) + '44'.repeat(16)
it('recovery ID matches Move binary golden without Buffer or random regeneration', () => {
  vi.stubGlobal('Buffer', undefined)
  expect(deriveContentUploadRecoveryId(recovery)).toBe(recoveryGolden)
  expect(fromHex(recoveryGolden)).toHaveLength(CONTENT_UPLOAD_RECOVERY_ID_BYTES)
  assertContentUploadRecoveryId(recoveryGolden, recovery)
  expect(readFileSync('move/soulidity/sources/content_envelope_tests.move', 'utf8')).toContain(recoveryGolden)
})
it.each(['author', 'contentObjectId', 'operationHash', 'nonce'] as const)('recovery cannot substitute %s', field => {
  const changed = { ...recovery, [field]: field === 'nonce' ? '55'.repeat(16) : field === 'operationHash' ? '55'.repeat(32) : id(0x55) }
  expect(deriveContentUploadRecoveryId(changed)).not.toBe(recoveryGolden)
  expect(() => assertContentUploadRecoveryId(recoveryGolden, changed)).toThrow('SCOPE_MISMATCH')
})
it.each(['author', 'contentObjectId'] as const)('recovery rejects noncanonical %s IDs', field => {
  for (const value of ['0x11', id(0), id(0xab).toUpperCase(), '11'.repeat(32), null, 11]) {
    expect(() => deriveContentUploadRecoveryId({ ...recovery, [field]: value } as never)).toThrow('ID_INVALID')
  }
})
it.each(['operationHash', 'nonce'] as const)('recovery rejects invalid %s bytes', field => {
  for (const value of ['', '0x' + recovery[field], recovery[field].slice(2), recovery[field] + '00', 'FF'.repeat(field === 'nonce' ? 16 : 32), new Uint8Array(32)]) {
    expect(() => deriveContentUploadRecoveryId({ ...recovery, [field]: value } as never)).toThrow('HASH_NONCE_INVALID')
  }
})
it.each(['0x' + recoveryGolden, recoveryGolden.toUpperCase(), recoveryGolden + '00', recoveryGolden.slice(2), 'ab'.repeat(32),
  '736f756c2d636f6e74656e743a' + recoveryGolden.slice(26)])('recovery rejects foreign/noncanonical document encoding', value => {
  expect(() => assertContentUploadRecoveryId(value, recovery)).toThrow('SCOPE_MISMATCH')
})
it('recovery rejects missing/extra scope fields rather than authorizing a partial tuple', () => {
  expect(() => deriveContentUploadRecoveryId({ ...recovery, privateDek: 'secret' } as never)).toThrow('SCOPE_INVALID')
  const { nonce: _nonce, ...missing } = recovery
  expect(() => deriveContentUploadRecoveryId(missing as never)).toThrow('SCOPE_INVALID')
})
