import { Transaction } from '@mysten/sui/transactions'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import type { CollectionBuyRecord, CollectionBuyTarget } from '../../../web/lib/collections/collection-buy-plan'

export const buyId = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
export const buyTarget = (): CollectionBuyTarget => ({ chainIdentifier: '35834a8a', originalPackageId: buyId(1),
  callablePackageId: buyId(2), callableDigest: toBase58(new Uint8Array(32).fill(7)), marketConfigId: buyId(3),
  kioskRegistryId: buyId(4), personalKioskTypePackageId: buyId(5), paymentCoinType: `${buyId(6)}::usdc::USDC`,
  kioskPackageId: buyId(7), collectionTransferPolicyId: buyId(8) })

/** Deliberately UI-only domain projection: no raw ledger read-set or fake chain
 * proof. The bytes are a real, completely built empty SDK transaction so the
 * production panel decodes real gas/epoch fields. It is never signed or sent.
 * Domain parsing/preparation and journal boundaries are explicitly mocked by
 * the hook suite; full purchase authority belongs to separate domain tests. */
export async function collectionBuyUIRecord(phase: CollectionBuyRecord['packet']['phase'] = 'PREPARED'): Promise<CollectionBuyRecord> {
  const author = buyId(10), tx = new Transaction()
  tx.setSender(author); tx.setGasOwner(author); tx.setGasPrice(1000); tx.setGasBudget(1000001)
  tx.setGasPayment([{ objectId: buyId(20), version: '1', digest: toBase58(new Uint8Array(32).fill(3)) }])
  tx.setExpiration({ Epoch: 11 })
  return { schema: 'soulidity.collection-buy.v1', plan: { schema: 'soulidity.collection-buy-plan.v1', target: buyTarget(),
    request: { collectionId: buyId(30), listingId: buyId(31) }, author, rightId: buyId(32), sellerAddress: buyId(33), sellerKioskId: buyId(34),
    buyerKiosk: { kind: 'NEW', kioskId: null, capId: null }, paymentCoinIds: [buyId(35)], objects: [], absentIds: [],
    expected: { collectionBcs: '', rightBcs: '', listingBcs: '', marketBcs: '', policyBcs: '' },
    quote: { priceAtomic: '1000001', sellerReceivesAtomic: '1000001', feeBps: 250, feeAtomic: '25001', buyerTotalAtomic: '1025002' } },
    packet: { bytes: toBase64(await tx.build()), digest: await tx.getDigest(), expirationEpoch: '11', phase,
      signature: phase === 'SIGNED' || phase === 'SUCCEEDED' || phase === 'FAILED' ? 'CONTROLLED_PUBLIC_SIGNATURE_NOT_CHAIN_PROOF' : null } }
}

export function buyDeferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
