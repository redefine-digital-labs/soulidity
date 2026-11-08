import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'
import { expect, it } from 'vitest'
import { aid, adigest } from './fixtures/activity-transaction-evidence'
import { buildNativePublicReadPaidPurchaseV2, buildNativePublicReadPaidQuoteV2, type NativePublicReadPaidPurchaseV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-transaction-v2'

const ref = (id: number) => ({ objectId: aid(id), initialSharedVersion: '1' })
function intent(): NativePublicReadPaidPurchaseV2 { return { format: 'native-public-read-v2', buyer: aid(71), nativeCallablePackageId: aid(41), coinType: '0x2::sui::SUI',
  registry: ref(78), config: ref(75), kiosk: ref(80), host: ref(94), kind: 1, quote: { hash: new Uint8Array(32).fill(1), total: '104' }, entryHash: null,
  feeRevision: '8', quoteExpiryMs: '2000', attempt: new Uint8Array(32).fill(2), paymentCoin: { objectId: aid(81), version: '9', digest: adigest(81), balance: '1000' } } }

// Actual installed SDK graphs for the isolated prototype ABI, not Move
// execution, source adoption, signed payment or usable protected delivery.
it.each([false, true])('composes the explicit V2 Host buy ABI without v1 service/rootRevision/Account, previous entry=%s', async existing => {
  const p = intent(); if (existing) p.entryHash = new Uint8Array(32).fill(3)
  const tx = buildNativePublicReadPaidPurchaseV2(p), data = tx.getData(), call = data.commands[1].MoveCall!
  expect(data.sender).toBe(p.buyer); expect(data.commands).toHaveLength(2)
  expect(call).toMatchObject({ package: p.nativeCallablePackageId, module: 'birth', function: 'buy_public_read_paid_v2' })
  expect(call.arguments).toHaveLength(12); expect(call.arguments[10]).toMatchObject({ NestedResult: [0, 0] })
  const pure = (i: number) => { const arg = call.arguments[i]; if (arg.$kind !== 'Input') throw Error('pure input required'); return fromBase64(data.inputs[arg.Input].Pure!.bytes) }
  const amount = data.commands[0].SplitCoins!.amounts[0]; if (amount.$kind !== 'Input') throw Error('split amount required')
  expect(bcs.u64().parse(fromBase64(data.inputs[amount.Input].Pure!.bytes))).toBe('104')
  expect(bcs.option(bcs.vector(bcs.u8())).parse(pure(6))).toEqual(existing ? [...p.entryHash!] : null)
  expect(bcs.u64().parse(pure(7))).toBe('8'); expect(bcs.u64().parse(pure(8))).toBe('2000')
  expect(data.inputs.flatMap(i => i.Object?.SharedObject ? [[i.Object.SharedObject.objectId, i.Object.SharedObject.mutable]] : [])).toEqual([
    [aid(78), false], [aid(75), true], [aid(80), false], [aid(94), true], [aid(6), false]])
  expect(data.gasData.payment).toBeNull()
  await expect(tx.build({ onlyTransactionKind: true })).resolves.toBeInstanceOf(Uint8Array)
})
it('composes the actual readonly quote ABI with Config/Host/kind only', async () => {
  const tx = buildNativePublicReadPaidQuoteV2(intent()), data = tx.getData(), call = data.commands[0].MoveCall!
  expect(data.commands).toHaveLength(1)
  expect(call).toMatchObject({ module: 'birth', function: 'quote_public_read_paid_v2' }); expect(call.arguments).toHaveLength(3)
  expect(data.inputs.flatMap(i => i.Object?.SharedObject ? [[i.Object.SharedObject.objectId, i.Object.SharedObject.mutable]] : [])).toEqual([[aid(75), false], [aid(94), false]])
  await expect(tx.build({ onlyTransactionKind: true })).resolves.toBeInstanceOf(Uint8Array)
})
it.each(['v1-format', 'service', 'rootRevision', 'account', 'host-alias', 'funds', 'zero-attempt', 'entry-size', 'shared-version'])('rejects cross-format or invalid V2 composition: %s', variant => {
  const p = intent()
  if (variant === 'v1-format') (p as any).format = 'native-paid-service-v1'
  if (variant === 'service') Object.assign(p, { service: ref(79) })
  if (variant === 'rootRevision') Object.assign(p, { rootRevision: '9' })
  if (variant === 'account') Object.assign(p, { account: ref(89) })
  if (variant === 'host-alias') p.host = p.config
  if (variant === 'funds') p.paymentCoin.balance = '103'
  if (variant === 'zero-attempt') p.attempt.fill(0)
  if (variant === 'entry-size') p.entryHash = new Uint8Array(31)
  if (variant === 'shared-version') p.host.initialSharedVersion = '01'
  expect(() => buildNativePublicReadPaidPurchaseV2(p)).toThrow()
})
