import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64, fromHex, toHex } from '@mysten/sui/utils'
import { assertPrivateNamedLoadoutDeployment, assertPrivateNamedLoadoutScope, assertPrivateNamedLoadoutCipherRef,
  buildSavePrivateNamedLoadoutTx, buildUpdatePrivateNamedLoadoutTx, buildPrivateNamedLoadoutSealApproval,
  derivePrivateNamedLoadoutSealId, PRIVATE_NAMED_LOADOUT_SEAL_DOMAIN, PRIVATE_NAMED_LOADOUT_MAX_CIPHERTEXT_BYTES,
  PrivateNamedLoadoutHeadFieldV1Bcs } from '../../packages/soulidity-sdk/src/private-named-loadout'
import { privateNamedLoadoutFixture, privateId } from './fixtures/private-named-loadout'

function argument(data: any, index: number) {
  const command = data.commands[0].MoveCall
  return data.inputs[command.arguments[index].Input]
}
const pure = (data: any, index: number, codec: any) => codec.parse(fromBase64(argument(data, index).Pure.bytes))
const params = (f: ReturnType<typeof privateNamedLoadoutFixture>) => ({ deployment: f.deployment, scope: f.scope,
  expectedRevision: '2', requestId: '03'.repeat(32), ciphertext: f.ref })

it('derives the exact Move BCS Seal domain independently and excludes library revision', async () => {
  const f = privateNamedLoadoutFixture(), domain = new TextEncoder().encode(PRIVATE_NAMED_LOADOUT_SEAL_DOMAIN)
  expect(domain.length).toBeLessThan(128)
  const epoch = new Uint8Array(8); new DataView(epoch.buffer).setBigUint64(0, 2n, true)
  const preimage = new Uint8Array([domain.length, ...domain, 1, ...fromHex(f.scope.soulId), ...fromHex(f.scope.stateId),
    ...fromHex(f.scope.owner), ...epoch])
  expect(toHex(await derivePrivateNamedLoadoutSealId(f.scope))).toBe(createHash('sha256').update(preimage).digest('hex'))
  for (const changed of [{ owner: privateId(99) }, { ownershipEpoch: '3' }, { stateId: privateId(99) }, { soulId: privateId(99) }]) {
    expect(toHex(await derivePrivateNamedLoadoutSealId({ ...f.scope, ...changed }))).not.toBe(toHex(await derivePrivateNamedLoadoutSealId(f.scope)))
  }
})

it('builds exact callable-package save ABI with real capture objects and a pure Blob ID', () => {
  const f = privateNamedLoadoutFixture(), data = buildSavePrivateNamedLoadoutTx({ ...params(f), protocolId: privateId(21), capture: f.capture }).getData()
  const command = data.commands[0].MoveCall!
  expect(data.sender).toBe(f.scope.owner)
  expect(command).toMatchObject({ package: f.deployment.callablePackageId, module: 'named_loadout_v1', function: 'save', typeArguments: [] })
  expect(command.arguments).toHaveLength(12)
  expect(argument(data, 0).UnresolvedObject.objectId).toBe(f.scope.stateId)
  expect(argument(data, 1).UnresolvedObject.objectId).toBe(f.capture.equipmentId)
  expect(argument(data, 2).UnresolvedObject.objectId).toBe(privateId(21))
  expect(pure(data, 3, bcs.u64())).toBe(f.scope.ownershipEpoch)
  expect(pure(data, 4, bcs.u64())).toBe('2')
  expect(pure(data, 5, bcs.vector(bcs.u8()))).toEqual(Array(32).fill(3))
  expect(pure(data, 6, bcs.Address)).toBe(f.ref.blobObjectId)
  expect(pure(data, 7, bcs.string())).toBe(f.ref.blobId)
  expect(toHex(new Uint8Array(pure(data, 8, bcs.vector(bcs.u8()))))).toBe(f.ref.sha256)
  expect(pure(data, 9, bcs.u64())).toBe(f.ref.byteLength)
  expect(pure(data, 10, bcs.u64())).toBe(f.capture.revision)
  expect(toHex(new Uint8Array(pure(data, 11, bcs.vector(bcs.u8()))))).toBe(f.capture.commitment)
})

it('update has no equipment/protocol dependency and approval has only its three input arguments', async () => {
  const f = privateNamedLoadoutFixture(), update = buildUpdatePrivateNamedLoadoutTx(params(f)).getData()
  expect(update.commands[0].MoveCall).toMatchObject({ function: 'update', typeArguments: [] })
  expect(update.commands[0].MoveCall!.arguments).toHaveLength(8)
  expect(update.inputs.filter(input => input.UnresolvedObject)).toHaveLength(1)
  const approval = (await buildPrivateNamedLoadoutSealApproval(params(f))).getData()
  expect(approval.commands[0].MoveCall).toMatchObject({ package: f.deployment.callablePackageId, function: 'seal_approve' })
  expect(approval.commands[0].MoveCall!.arguments).toHaveLength(3)
  expect(new Uint8Array(pure(approval, 0, bcs.vector(bcs.u8())))).toEqual(await derivePrivateNamedLoadoutSealId(f.scope))
  expect(argument(approval, 1).UnresolvedObject.objectId).toBe(f.scope.stateId)
  expect(pure(approval, 2, bcs.u64())).toBe(f.scope.ownershipEpoch)
})

it('preserves u64 precision and freezes cloned scope/reference inputs', () => {
  const f = privateNamedLoadoutFixture()
  const scope = assertPrivateNamedLoadoutScope({ ...f.scope, ownershipEpoch: '18446744073709551615' })
  expect(scope.ownershipEpoch).toBe('18446744073709551615'); expect(Object.isFrozen(scope)).toBe(true)
  const data = buildUpdatePrivateNamedLoadoutTx({ ...params(f), expectedRevision: '18446744073709551614' }).getData()
  expect(pure(data, 2, bcs.u64())).toBe('18446744073709551614')
  expect(Object.isFrozen(assertPrivateNamedLoadoutCipherRef(f.ref))).toBe(true)
  expect(Object.isFrozen(assertPrivateNamedLoadoutDeployment(f.deployment))).toBe(true)
  const next = assertPrivateNamedLoadoutScope(f.scope); f.scope.owner = privateId(80)
  expect(next.owner).toBe(privateId(5))
})

describe('rejects noncanonical or unbounded mutation inputs', () => {
  it.each(['-1', '01', '1.0', '18446744073709551616', '', 2])('u64 %s', value => {
    const f = privateNamedLoadoutFixture()
    expect(() => buildUpdatePrivateNamedLoadoutTx({ ...params(f), expectedRevision: value as string })).toThrow()
  })
  it.each(['', '00'.repeat(32), 'AB'.repeat(32), 'aa'.repeat(31), 'gg'.repeat(32)])('request/hash %s', value => {
    const f = privateNamedLoadoutFixture()
    expect(() => buildUpdatePrivateNamedLoadoutTx({ ...params(f), requestId: value })).toThrow()
    expect(() => assertPrivateNamedLoadoutCipherRef({ ...f.ref, sha256: value })).toThrow()
  })
  it('rejects exhaustion, scope fields, byte budget and noncanonical Base64URL', () => {
    const f = privateNamedLoadoutFixture()
    expect(() => buildUpdatePrivateNamedLoadoutTx({ ...params(f), expectedRevision: '18446744073709551615' })).toThrow('REVISION_EXHAUSTED')
    expect(() => assertPrivateNamedLoadoutScope({ ...f.scope, name: 'private' } as any)).toThrow('INVALID_FIELDS')
    expect(() => assertPrivateNamedLoadoutCipherRef({ ...f.ref, byteLength: String(PRIVATE_NAMED_LOADOUT_MAX_CIPHERTEXT_BYTES + 1) })).toThrow('BUDGET')
    expect(() => assertPrivateNamedLoadoutCipherRef({ ...f.ref, byteLength: '0' })).toThrow('BUDGET')
    expect(() => assertPrivateNamedLoadoutCipherRef({ ...f.ref, blobId: 'A'.repeat(42) + 'B' })).toThrow('INVALID_BLOB_ID')
    expect(() => buildSavePrivateNamedLoadoutTx({ ...params(f), protocolId: f.scope.stateId, capture: f.capture })).toThrow('CAPTURE_ALIAS')
  })
})

it('ties fixture schemas and ABI identifiers to the actual Move source without adding private public fields', () => {
  const f = privateNamedLoadoutFixture(), bytes = PrivateNamedLoadoutHeadFieldV1Bcs.serialize(f.headField).toBytes()
  expect(PrivateNamedLoadoutHeadFieldV1Bcs.parse(bytes)).toEqual(f.headField)
  const move = readFileSync(new URL('../../move/soulidity/sources/named_loadout_v1.move', import.meta.url), 'utf8')
  const soul = readFileSync(new URL('../../move/soulidity/sources/soul.move', import.meta.url), 'utf8')
  expect(move).toContain(`b"${PRIVATE_NAMED_LOADOUT_SEAL_DOMAIN}"`)
  expect(move).toMatch(/MAX_CIPHERTEXT_BYTES: u64 = 16_777_216/)
  expect(soul).toMatch(/struct NamedLoadoutHeadKeyV1[^}]*version: u8/s)
  expect(move.match(/public struct HeadV1[^}]+}/s)?.[0]).toMatch(/version: u8,[\s\S]*soul_id: ID,[\s\S]*state_id: ID,[\s\S]*owner: address,[\s\S]*ownership_epoch: u64,[\s\S]*revision: u64,[\s\S]*ciphertext: CipherRefV1,[\s\S]*receipts: vector<ReceiptV1>/)
  expect(move.match(/public struct HeadV1[^}]+}/s)?.[0]).not.toMatch(/name|count|plaintext/)
})
