import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder, Inputs } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { aid, adigest } from './fixtures/activity-transaction-evidence'
import { buildNativePaidContentPurchase } from '../../web/lib/soulidity/commerce/native-paid-content-transaction'
import { buildNativePublicReadPaidPurchaseV2, type NativePublicReadPaidPurchaseV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-transaction-v2'
import { assertNativePublicReadPaidPacketV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-packet-v2'

async function fixture(v1 = false, multiGas = false, guarded = false) {
  const ref = (id: number) => ({ objectId: aid(id), initialSharedVersion: '1' })
  const intent: NativePublicReadPaidPurchaseV2 = { format: 'native-public-read-v2', buyer: aid(71), nativeCallablePackageId: aid(41), coinType: '0x2::sui::SUI', registry: ref(78), config: ref(75), kiosk: ref(80), host: ref(94),
    kind: 1, quote: { hash: new Uint8Array(32).fill(1), total: '104' }, entryHash: null, feeRevision: '8', quoteExpiryMs: '2000', attempt: new Uint8Array(32).fill(2), paymentCoin: { objectId: aid(81), version: '9', digest: adigest(81), balance: '1000' } }
  if (guarded) intent.recordGuard = { index: 27, namespace: 'a4'.repeat(101) }
  const tx = v1 ? buildNativePaidContentPurchase({ ...intent, service: intent.host, rootRevision: '9' }) : buildNativePublicReadPaidPurchaseV2(intent)
  const gasCoins = [{ objectId: aid(82), version: 9, digest: adigest(82) }, ...(multiGas ? [{ objectId: aid(83), version: 9, digest: adigest(83) }] : [])]
  tx.setGasOwner(intent.buyer); tx.setGasPrice(1); tx.setGasBudget(1000); tx.setGasPayment(gasCoins); tx.setExpiration({ Epoch: 6 })
  const bytes = await tx.build()
  return { intent, gas: { budget: '1000', price: '1', coins: gasCoins.map(ref => ({ ...ref, version: String(ref.version) })) }, packet: { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '6' } }
}
it('matches original canonical V2 whole kind and independently reviewed gas without granting signing or delivery', async () => {
  const f = await fixture(), original = structuredClone(f.packet)
  expect(await assertNativePublicReadPaidPacketV2(f.intent, f.packet, f.gas)).toMatchObject({ format: 'native-public-read-v2', wholeKindMatched: true, reviewedGasMatched: true, notSigningQualification: true, notBusinessReceipt: true, notDeliveryProof: true })
  expect(f.packet).toEqual(original)
})
it('rejects V1 original bytes rather than interpreting its service as a V2 Host', async () => {
  const f = await fixture(true)
  await expect(assertNativePublicReadPaidPacketV2(f.intent, f.packet, f.gas)).rejects.toThrow('WHOLE_KIND')
})
it.each(['extra-call', 'amount', 'fee-revision', 'attempt', 'previous-entry', 'quote-hash', 'payment-reference', 'gas-order', 'kiosk-mutable', 'host-readonly', 'host-id', 'callable', 'sender', 'expiration', 'sponsor', 'gas-alias', 'gas-duplicate', 'gas-budget', 'gas-digest', 'digest'])('rejects substituted V2 packet: %s', async variant => {
  const f = await fixture(false, variant === 'gas-order'), data = Transaction.from(fromBase64(f.packet.bytes)).getData()
  if (variant === 'extra-call') data.commands.push(structuredClone(data.commands[1]))
  if (variant === 'amount') { const arg = data.commands[0].SplitCoins!.amounts[0]; if (arg.$kind !== 'Input') throw Error('amount input'); data.inputs[arg.Input] = Inputs.Pure(bcs.u64().serialize(103).toBytes()) }
  if (variant === 'fee-revision') { const arg = data.commands[1].MoveCall!.arguments[7]; if (arg.$kind !== 'Input') throw Error('fee input'); data.inputs[arg.Input] = Inputs.Pure(bcs.u64().serialize(9).toBytes()) }
  if (['attempt', 'previous-entry', 'quote-hash'].includes(variant)) { const arg = data.commands[1].MoveCall!.arguments[variant === 'attempt' ? 9 : variant === 'previous-entry' ? 6 : 5]; if (arg.$kind !== 'Input') throw Error('snapshot input'); data.inputs[arg.Input] = Inputs.Pure(variant === 'previous-entry' ? bcs.option(bcs.vector(bcs.u8())).serialize(new Array(32).fill(3)).toBytes() : bcs.vector(bcs.u8()).serialize(new Array(32).fill(9)).toBytes()) }
  if (variant === 'payment-reference') data.inputs.find(i => i.Object?.ImmOrOwnedObject?.objectId === f.intent.paymentCoin.objectId)!.Object!.ImmOrOwnedObject!.version = '8'
  if (variant === 'gas-order') data.gasData.payment!.reverse()
  if (variant === 'kiosk-mutable') data.inputs.find(i => i.Object?.SharedObject?.objectId === f.intent.kiosk.objectId)!.Object!.SharedObject!.mutable = true
  if (variant === 'host-readonly') data.inputs.find(i => i.Object?.SharedObject?.objectId === f.intent.host.objectId)!.Object!.SharedObject!.mutable = false
  if (variant === 'host-id') data.inputs.find(i => i.Object?.SharedObject?.objectId === f.intent.host.objectId)!.Object!.SharedObject!.objectId = aid(99)
  if (variant === 'callable') data.commands[1].MoveCall!.package = aid(99)
  if (variant === 'sender') data.sender = aid(99)
  if (variant === 'expiration') data.expiration = { Epoch: 7, $kind: 'Epoch' }
  if (variant === 'sponsor') data.gasData.owner = aid(99)
  if (variant === 'gas-alias') data.gasData.payment![0].objectId = f.intent.paymentCoin.objectId
  if (variant === 'gas-duplicate') data.gasData.payment!.push(structuredClone(data.gasData.payment![0]))
  if (variant === 'gas-budget') data.gasData.budget = '1001'
  if (variant === 'gas-digest') data.gasData.payment![0].digest = adigest(99)
  const bytes = TransactionDataBuilder.restore(data).build(); f.packet.bytes = toBase64(bytes); f.packet.digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  if (variant === 'digest') f.packet.digest = adigest(99)
  await expect(assertNativePublicReadPaidPacketV2(f.intent, f.packet, f.gas)).rejects.toThrow()
})

it('accepts multiple independent reviewed Gas references in exactly their approved order', async () => {
  const f = await fixture(false, true)
  expect(await assertNativePublicReadPaidPacketV2(f.intent, f.packet, f.gas)).toMatchObject({ reviewedGasMatched: true, requiresCurrentHostRecordEntryQuoteAndFundingProof: true })
})

it.each(['remove', 'swap-order', 'index', 'namespace', 'package'] as const)('rejects a rehashed guarded packet with %s substitution', async mode => {
  const f = await fixture(false, false, true)
  const data = Transaction.from(fromBase64(f.packet.bytes)).getData()
  if (mode === 'remove') data.commands.pop()
  if (mode === 'swap-order') [data.commands[1], data.commands[2]] = [data.commands[2], data.commands[1]]
  if (mode === 'package') data.commands[2].MoveCall!.package = aid(999)
  if (mode === 'index' || mode === 'namespace') {
    const arg = data.commands[2].MoveCall!.arguments[mode === 'index' ? 3 : 0]
    if (arg.$kind !== 'Input') throw Error('GUARD_INPUT_REQUIRED')
    data.inputs[arg.Input] = Inputs.Pure(mode === 'index' ? bcs.u64().serialize(28).toBytes()
      : bcs.byteVector().serialize(new Uint8Array(101).fill(7)).toBytes())
  }
  const bytes = TransactionDataBuilder.restore(data).build()
  await expect(assertNativePublicReadPaidPacketV2(f.intent, { ...f.packet, bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) }, f.gas))
    .rejects.toThrow()
})
