import { expect, it, vi, afterEach } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Inputs, Transaction } from '@mysten/sui/transactions'
import { buildAnimacraftNativeCompleteApprovalV8, type AnimacraftNativeCompleteApprovalV8 } from '@soulidity/sdk'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const keys = ['soulStateId', 'provenanceBindingId', 'completeOutputId', 'receiptId',
  'makerRootId', 'protocolConfigId', 'catalogId', 'releaseConfigId', 'sealRegistryId', 'sealPolicyId'] as const
const fixture = (): AnimacraftNativeCompleteApprovalV8 => ({
  releaseCallablePackageId: id(1), signer: id(2), soulStateId: id(3), provenanceBindingId: id(4),
  completeOutputId: id(5), receiptId: id(6), makerRootId: id(7), protocolConfigId: id(8), catalogId: id(9),
  releaseConfigId: id(10), sealRegistryId: id(11), sealPolicyId: id(12), paymentCoinType: '0x2::sui::SUI', sealId: Array(32).fill(77),
})
afterEach(() => vi.unstubAllEnvs())

it('builds only the exact Release native read entry with no prerequisite proof command or gas', () => {
  const p = fixture(); const tx = buildAnimacraftNativeCompleteApprovalV8(p); const data = tx.getData()
  expect(data.sender).toBe(p.signer); expect(data.commands).toHaveLength(1)
  const call = data.commands[0]!.MoveCall!
  expect(call).toMatchObject({ package: p.releaseCallablePackageId, module: 'release_v8',
    function: 'seal_approve_complete_v8', typeArguments: [p.paymentCoinType] })
  expect(call.arguments).toHaveLength(11)
  expect(call.arguments.every(arg => arg.$kind === 'Input')).toBe(true)
  const first = data.inputs[(call.arguments[0] as { Input: number }).Input]!
  expect(bcs.vector(bcs.u8()).fromBase64(first.Pure!.bytes)).toEqual(p.sealId)
  expect(call.arguments.slice(1).map(arg => data.inputs[(arg as { Input: number }).Input]!.UnresolvedObject!.objectId))
    .toEqual(keys.map(key => p[key]))
  expect(data.gasData.payment).toBeNull()
})

it.each(['releaseCallablePackageId', 'signer', ...keys] as const)('rejects missing/wrong %s instead of consulting an old environment', key => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(20))
  for (const value of ['', '0x1', id(0), null, `${id(2)}::module::type`]) {
    expect(() => buildAnimacraftNativeCompleteApprovalV8({ ...fixture(), [key]: value } as any)).toThrow('canonical nonzero')
  }
})

it('rejects malformed coin type and every malformed key identity', () => {
  for (const paymentCoinType of ['', 'u64', 'not::valid::type::<']) {
    expect(() => buildAnimacraftNativeCompleteApprovalV8({ ...fixture(), paymentCoinType })).toThrow()
  }
  for (const sealId of [[], Array(31).fill(1), Array(33).fill(1), Array(32).fill(-1), Array(32).fill(256), Array(32).fill(1.5), null]) {
    expect(() => buildAnimacraftNativeCompleteApprovalV8({ ...fixture(), sealId } as any)).toThrow('32 bytes')
  }
})

it('snapshots fields and roundtrips actual TransactionKind with fixture object refs, not wallet signing', async () => {
  const p = fixture(); const original = structuredClone(p); const tx = buildAnimacraftNativeCompleteApprovalV8(p)
  p.sealId.fill(0); p.soulStateId = id(99); p.releaseCallablePackageId = id(98)
  const resolve = async (data: any, _options: any, next: () => Promise<void>) => {
    data.inputs = data.inputs.map((input: any) => input.UnresolvedObject
      ? Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1', mutable: false }) : input)
    await next()
  }
  const bytes = await tx.build({ client: { core: { resolveTransactionPlugin: () => resolve } } as any, onlyTransactionKind: true })
  const decoded = Transaction.fromKind(bytes)
  expect(await decoded.build({ onlyTransactionKind: true })).toEqual(bytes)
  const data = decoded.getData(); const call = data.commands[0]!.MoveCall!
  expect(call.package).toBe(original.releaseCallablePackageId)
  expect(bcs.vector(bcs.u8()).fromBase64(data.inputs[(call.arguments[0] as { Input: number }).Input]!.Pure!.bytes)).toEqual(original.sealId)
  // Official ValidPtb restrictions: same-package seal_approve MoveCalls, every
  // argument is an Input, first argument is pure vector<u8>; no Result/GasCoin.
  expect(data.commands).toHaveLength(1)
  expect(call.function.startsWith('seal_approve')).toBe(true)
  expect(call.arguments.every(arg => arg.$kind === 'Input')).toBe(true)
  expect(data.inputs.slice(1).every(input => input.Object?.SharedObject?.mutable === false)).toBe(true)
})
