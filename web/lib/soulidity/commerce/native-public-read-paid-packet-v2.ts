import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import type { NativePaidReviewedGas } from './native-paid-content-packet'
import { commerceCheck, commerceId } from './economics-read'
import { buildNativePublicReadPaidPurchaseV2, type NativePublicReadPaidPurchaseV2 } from './native-public-read-paid-transaction-v2'

/** Explicit V2 packet comparison only. Intent and Gas review must be supplied
 * independently of candidate commands/gas. No old packet is rewritten, no
 * unknown/V1 ABI is reinterpreted. Current Host/source/Record/Entry/quote/funds,
 * exact actual interface, simulation and durable execution remain separate.
 * The shared transport envelope/Gas shape grants no V1 ownership semantics.
 */
export async function assertNativePublicReadPaidPacketV2(intent: NativePublicReadPaidPurchaseV2,
  original: Pick<PublicMutationPacket, 'bytes' | 'digest' | 'expirationEpoch'>, reviewedGas: NativePaidReviewedGas) {
  const p = structuredClone(intent), packet = structuredClone(original), plannedGas = structuredClone(reviewedGas)
  commerceCheck(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 180000
    && typeof packet.expirationEpoch === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(packet.expirationEpoch)
    && BigInt(packet.expirationEpoch) <= (1n << 64n) - 1n, 'PUBLIC_PAID_V2_PACKET_BOUND')
  const bytes = fromBase64(packet.bytes), raw = bcs.TransactionData.parse(bytes), data = Transaction.from(bytes).getData()
  commerceCheck(toBase64(bcs.TransactionData.serialize(raw).toBytes()) === packet.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest, 'PUBLIC_PAID_V2_PACKET_CANONICAL_DIGEST')
  commerceCheck(data.sender === p.buyer && data.expiration?.Epoch !== undefined
    && String(data.expiration.Epoch) === packet.expirationEpoch, 'PUBLIC_PAID_V2_PACKET_IDENTITY')
  const expected = await buildNativePublicReadPaidPurchaseV2(p).build({ onlyTransactionKind: true })
  commerceCheck(toBase64(expected) === toBase64(bcs.TransactionKind.serialize(raw.V1.kind).toBytes()), 'PUBLIC_PAID_V2_PACKET_WHOLE_KIND')
  const gas = data.gasData
  commerceCheck(gas.owner === p.buyer && gas.budget && BigInt(gas.budget) > 0n && gas.price && BigInt(gas.price) > 0n
    && gas.payment && gas.payment.length > 0 && gas.payment.length <= 256, 'PUBLIC_PAID_V2_PACKET_GAS')
  commerceCheck(gas.budget === plannedGas.budget && gas.price === plannedGas.price && gas.payment.length === plannedGas.coins.length
    && gas.payment.every((ref, i) => ref.objectId === plannedGas.coins[i].objectId && String(ref.version) === plannedGas.coins[i].version
      && ref.digest === plannedGas.coins[i].digest), 'PUBLIC_PAID_V2_PACKET_REVIEWED_GAS')
  const inputs = new Set(data.inputs.flatMap(i => i.Object?.SharedObject ? [i.Object.SharedObject.objectId]
    : i.Object?.ImmOrOwnedObject ? [i.Object.ImmOrOwnedObject.objectId] : i.Object?.Receiving ? [i.Object.Receiving.objectId] : []))
  commerceCheck(new Set(gas.payment.map(c => c.objectId)).size === gas.payment.length
    && gas.payment.every(c => commerceId(c.objectId) && !inputs.has(c.objectId) && BigInt(c.version) > 0n), 'PUBLIC_PAID_V2_PACKET_GAS_ALIAS')
  return { format: 'native-public-read-v2' as const, transactionDigest: packet.digest, buyer: p.buyer, expirationEpoch: packet.expirationEpoch,
    wholeKindMatched: true as const, reviewedGasMatched: true as const, requiresQualifiedSourceAndFormatAdoption: true as const, requiresCurrentHostRecordEntryQuoteAndFundingProof: true as const,
    requiresActualInterfaceAndFullSimulation: true as const, notSigningQualification: true as const, notBusinessReceipt: true as const, notDeliveryProof: true as const }
}
