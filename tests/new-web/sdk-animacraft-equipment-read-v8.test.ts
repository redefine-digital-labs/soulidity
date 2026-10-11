import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Inputs, Transaction } from '@mysten/sui/transactions'
import { buildAnimacraftEquipmentReadApprovalV8, type AnimacraftEquipmentReadApprovalV8 } from '@soulidity/sdk'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const fixture = (kind: AnimacraftEquipmentReadApprovalV8['kind']): AnimacraftEquipmentReadApprovalV8 => ({
  releaseCallablePackageId: id(1), signer: id(2), soulStateId: id(3), equipmentId: id(4),
  makerRootId: id(5), protocolConfigId: id(6), catalogId: id(7), releaseConfigId: id(8),
  sealRegistryId: id(9), sealPolicyId: id(10), makerAccessPassId: id(11),
  paymentCoinType: '0x2::sui::SUI', selectionIndex: '7', partKey: 'body', itemKey: 'coat', styleKey: 'blue',
  ciphertextBlobCommitment: Array(32).fill(20), certificationCommitment: Array(32).fill(21), sealId: Array(32).fill(22),
  ...(kind === 'base' ? { kind, definitionRegistryId: id(12), baseRegistryId: id(13) }
    : kind === 'owned-base' ? { kind, definitionRegistryId: id(12), baseRegistryId: id(13), packRegistryId: id(14), ownedBaseItemId: id(15) }
      : { kind, packRegistryId: id(14), packReleaseId: id(16), packPassId: id(17),
        assetContentCommitment: Array(32).fill(23), ciphertextBlobId: 'A'.repeat(43), ciphertextSha256: Array(32).fill(24) }),
})
const kinds = ['base', 'owned-base', 'pack'] as const

it.each(kinds)('%s read is one exact Release Input-only approval with native state before equipment', async kind => {
  const p = fixture(kind); const original = structuredClone(p)
  const tx = buildAnimacraftEquipmentReadApprovalV8(p)
  p.sealId.fill(0); p.soulStateId = id(99)
  const resolve = async (data: any, _options: any, next: () => Promise<void>) => {
    data.inputs = data.inputs.map((input: any) => input.UnresolvedObject
      ? Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1', mutable: false }) : input)
    await next()
  }
  const bytes = await tx.build({ onlyTransactionKind: true,
    client: { core: { resolveTransactionPlugin: () => resolve } } as any })
  const restored = Transaction.fromKind(bytes)
  expect(await restored.build({ onlyTransactionKind: true })).toEqual(bytes)
  const data = restored.getData(); expect(data.commands).toHaveLength(1)
  const call = data.commands[0].MoveCall!
  expect(call).toMatchObject({ package: id(1), module: 'release_v8',
    function: `seal_approve_equipped_${kind.replace('-', '_')}_v8`, typeArguments: [`${id(2)}::sui::SUI`] })
  expect(call.arguments).toHaveLength({ base: 19, 'owned-base': 21, pack: 23 }[kind])
  expect(call.arguments.every(arg => arg.$kind === 'Input')).toBe(true)
  const inputs = call.arguments.map(arg => data.inputs[(arg as { Input: number }).Input])
  const objectEnd = { base: 12, 'owned-base': 14, pack: 13 }[kind]
  expect(inputs.slice(1, objectEnd).map(input => input.Object!.SharedObject!.objectId)).toEqual([
    id(8), id(3), id(6), id(4), ...(kind === 'pack'
      ? [id(14), id(16), id(17), id(7), id(5), id(11)]
      : [...(kind === 'owned-base' ? [id(15), id(12), id(14)] : [id(12)]), id(13), id(5), id(11), id(7)]), id(9), id(10),
  ])
  expect(inputs.slice(1, objectEnd).every(input => input.Object!.SharedObject!.mutable === false)).toBe(true)
  expect(bcs.vector(bcs.u8()).fromBase64(inputs[0].Pure!.bytes)).toEqual(original.sealId)
  expect(bcs.u64().fromBase64(inputs[objectEnd].Pure!.bytes)).toBe('7')
  expect(inputs.slice(objectEnd + 1, objectEnd + 4).map(input => bcs.string().fromBase64(input.Pure!.bytes)))
    .toEqual(['body', 'coat', 'blue'])
  expect(bcs.vector(bcs.u8()).fromBase64(inputs.at(-1)!.Pure!.bytes)).toEqual(original.sealId)
  if (kind === 'pack') {
    expect(bcs.vector(bcs.u8()).fromBase64(inputs[17].Pure!.bytes)).toEqual(Array(32).fill(23))
    expect(bcs.string().fromBase64(inputs[18].Pure!.bytes)).toBe('A'.repeat(43))
    expect(bcs.vector(bcs.u8()).fromBase64(inputs[19].Pure!.bytes)).toEqual(Array(32).fill(24))
  }
  expect(tx.getData().gasData.payment).toBeNull()
})

it.each(kinds)('%s rejects absent/aliased IDs, malformed slot, key and protection hashes', kind => {
  const p = fixture(kind)
  for (const field of Object.keys(p).filter(key => key.endsWith('Id') || key === 'signer')) {
    if (field === 'ciphertextBlobId') continue
    for (const value of ['', '0x1', id(0), null]) {
      expect(() => buildAnimacraftEquipmentReadApprovalV8({ ...p, [field]: value } as any), field).toThrow()
    }
  }
  for (const selectionIndex of ['-1', '01', '1.1', '500', '18446744073709551616', 7, null]) {
    expect(() => buildAnimacraftEquipmentReadApprovalV8({ ...p, selectionIndex } as any)).toThrow('slot index')
  }
  for (const field of ['partKey', 'itemKey', 'styleKey']) {
    for (const value of ['', '\0', 'part/style', '😀'.repeat(33)]) {
      expect(() => buildAnimacraftEquipmentReadApprovalV8({ ...p, [field]: value })).toThrow('semantic key')
    }
  }
  for (const field of ['sealId', 'ciphertextBlobCommitment', 'certificationCommitment',
    ...(kind === 'pack' ? ['assetContentCommitment', 'ciphertextSha256'] : [])]) {
    for (const value of [[], Array(31).fill(1), Array(33).fill(1), Array(32).fill(256), Array(32).fill(0.5)]) {
      expect(() => buildAnimacraftEquipmentReadApprovalV8({ ...p, [field]: value })).toThrow('32 bytes')
    }
  }
})

it('never uses a Player approval or inferred coin/blob authority', () => {
  for (const kind of ['external', '', undefined]) {
    expect(() => buildAnimacraftEquipmentReadApprovalV8({ ...fixture('pack'), kind } as any)).toThrow('source')
  }
  for (const paymentCoinType of ['', 'u64', 'not::a::struct<']) {
    expect(() => buildAnimacraftEquipmentReadApprovalV8({ ...fixture('base'), paymentCoinType })).toThrow()
  }
  for (const ciphertextBlobId of ['', 'blob', '../blob', 'A'.repeat(42) + 'B', 'A'.repeat(44)]) {
    expect(() => buildAnimacraftEquipmentReadApprovalV8({ ...fixture('pack'), ciphertextBlobId } as any)).toThrow('Walrus blob')
  }
})

it('BUG-013: Pack approval preserves a canonical Quilt patch, rejecting malformed ranges and aliases', () => {
  const bytes = new Uint8Array(37); bytes.fill(42, 0, 32); bytes[32] = 1
  const range = new DataView(bytes.buffer); range.setUint16(33, 1, true); range.setUint16(35, 13, true)
  const patch = Buffer.from(bytes).toString('base64url')
  const tx = buildAnimacraftEquipmentReadApprovalV8({ ...fixture('pack'), ciphertextBlobId: patch } as any)
  const data = tx.getData(), call = data.commands[0].MoveCall!
  const input = data.inputs[(call.arguments[18] as { Input: number }).Input]
  expect(bcs.string().fromBase64(input.Pure!.bytes)).toBe(patch)
  const invalid = [patch + '==', patch.slice(0, -1) + 'B', `https://example.com/${patch}`]
  for (const [offset, value] of [[32, 2], [33, 0], [35, 1]]) {
    const bad = new Uint8Array(bytes); bad[offset] = value; invalid.push(Buffer.from(bad).toString('base64url'))
  }
  for (const ciphertextBlobId of invalid) {
    expect(() => buildAnimacraftEquipmentReadApprovalV8({ ...fixture('pack'), ciphertextBlobId } as any)).toThrow('canonical Walrus')
  }
})
