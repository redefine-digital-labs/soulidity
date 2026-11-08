import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { commerceCheck, commerceId } from './economics-read'
import { buildNativePaidContentPurchase, type NativePaidContentPurchase } from './native-paid-content-transaction'

export interface NativePaidReviewedGas { budget: string; price: string;
  coins: Array<{ objectId: string; version: string; digest: string }> }

/** Exact current-ABI packet check against independently supplied intent.
 * Never infers the intended call from candidate commands or changes saved
 * bytes. Historical records need their own original ABI/schema context; this
 * validator must not relabel unknown old records as this product. Intent and
 * reviewed gas must come from the independent plan, never the candidate. No simulation,
 * fresh funding/authority, source qualification, journal or signature is proved.
 */
export async function assertNativePaidContentPacket(intent: NativePaidContentPurchase,
  original: Pick<PublicMutationPacket, 'bytes' | 'digest' | 'expirationEpoch'>, reviewedGas: NativePaidReviewedGas) {
  const p = structuredClone(intent), packet = structuredClone(original), plannedGas = structuredClone(reviewedGas)
  commerceCheck(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 180000
    && /^(0|[1-9][0-9]{0,19})$/.test(packet.expirationEpoch) && BigInt(packet.expirationEpoch) <= (1n << 64n) - 1n, 'PAID_PACKET_BOUND')
  const bytes = fromBase64(packet.bytes), raw = bcs.TransactionData.parse(bytes), data = Transaction.from(bytes).getData()
  commerceCheck(toBase64(bcs.TransactionData.serialize(raw).toBytes()) === packet.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest, 'PAID_PACKET_CANONICAL_DIGEST')
  commerceCheck(data.sender === p.buyer && data.expiration?.Epoch !== undefined
    && String(data.expiration.Epoch) === packet.expirationEpoch, 'PAID_PACKET_SENDER_EXPIRATION')
  const expected = await buildNativePaidContentPurchase(p).build({ onlyTransactionKind: true })
  commerceCheck(toBase64(expected) === toBase64(bcs.TransactionKind.serialize(raw.V1.kind).toBytes()), 'PAID_PACKET_WHOLE_KIND')
  const gas = data.gasData
  commerceCheck(gas.owner === p.buyer && gas.budget && BigInt(gas.budget) > 0n && gas.price && BigInt(gas.price) > 0n
    && gas.payment && gas.payment.length > 0 && gas.payment.length <= 256, 'PAID_PACKET_GAS')
  commerceCheck(gas.budget === plannedGas.budget && gas.price === plannedGas.price
    && gas.payment.length === plannedGas.coins.length && gas.payment.every((ref, i) => ref.objectId === plannedGas.coins[i].objectId
      && String(ref.version) === plannedGas.coins[i].version && ref.digest === plannedGas.coins[i].digest), 'PAID_PACKET_REVIEWED_GAS')
  const inputs = new Set(data.inputs.flatMap(i => i.Object?.SharedObject ? [i.Object.SharedObject.objectId]
    : i.Object?.ImmOrOwnedObject ? [i.Object.ImmOrOwnedObject.objectId] : i.Object?.Receiving ? [i.Object.Receiving.objectId] : []))
  commerceCheck(new Set(gas.payment.map(c => c.objectId)).size === gas.payment.length
    && gas.payment.every(c => commerceId(c.objectId) && !inputs.has(c.objectId) && BigInt(c.version) > 0n), 'PAID_PACKET_GAS_ALIAS')
  return { digest: packet.digest, buyer: p.buyer, expirationEpoch: packet.expirationEpoch,
    wholeKindMatched: true as const, notSigningQualification: true as const, notBusinessReceipt: true as const }
}
