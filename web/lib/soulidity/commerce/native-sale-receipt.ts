import { bcs } from '@mysten/sui/bcs'
import { quoteNativeSale } from './native-sale-quote'

/** Payload layout from current soulidity_native::market::Sold.
 * Parsing this payload alone is NEVER transaction or delivery success evidence.
 * The caller must authenticate transaction bytes, effects, checkpoint, event
 * digest, emitting callable package and type origin before using this result.
 */
export const NativeSoldBcs = bcs.struct('Sold', {
  offer: bcs.Address, root: bcs.Address, seller: bcs.Address, buyer: bcs.Address,
  seller_kiosk: bcs.Address, buyer_kiosk: bcs.Address,
  ask: bcs.u64(), platform: bcs.u64(), creator: bcs.u64(), collection: bcs.option(bcs.Address),
  collection_amount: bcs.u64(), collection_holder: bcs.Address,
  collection_snapshot: bcs.option(bcs.vector(bcs.u8())), total: bcs.u64(),
  old_generation: bcs.u64(), attempt: bcs.vector(bcs.u8()),
})

export interface NativeSoldExpectation {
  offer: string; root: string; seller: string; buyer: string; sellerKiosk: string; buyerKiosk: string
  ask: bigint; secondaryBps: number; creatorBps: number; collectionBps: number
  collection: string | null; collectionHolder: string; collectionSnapshot: Uint8Array | null
  generation: bigint; attempt: Uint8Array
}

export function validateNativeSoldPayload(bytes: Uint8Array, expected: NativeSoldExpectation) {
  const row = NativeSoldBcs.parse(bytes)
  const quote = quoteNativeSale(expected.ask, expected)
  const same = (a: Uint8Array | number[], b: Uint8Array | number[]) => a.length === b.length && a.every((v, i) => v === b[i])
  if (!same(NativeSoldBcs.serialize(row).toBytes(), bytes)
    || row.offer !== expected.offer || row.root !== expected.root || row.seller !== expected.seller || row.buyer !== expected.buyer
    || row.seller_kiosk !== expected.sellerKiosk || row.buyer_kiosk !== expected.buyerKiosk
    || row.collection !== expected.collection || row.collection_holder !== expected.collectionHolder
    || (row.collection_snapshot === null) !== (expected.collectionSnapshot === null)
    || (row.collection_snapshot !== null && !same(row.collection_snapshot, expected.collectionSnapshot!))
    || BigInt(row.ask) !== quote.ask || BigInt(row.platform) !== quote.platform || BigInt(row.creator) !== quote.creator
    || BigInt(row.collection_amount) !== quote.collection || BigInt(row.total) !== quote.total
    || BigInt(row.old_generation) !== expected.generation || !same(row.attempt, expected.attempt)) {
    throw new Error('Native Sold payload identity or settlement mismatch')
  }
  return row
}
