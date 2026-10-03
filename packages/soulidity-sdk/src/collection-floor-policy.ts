/** Collection display/listing policy; deliberately not a Move sale permission. */
export const MAX_COLLECTION_FLOOR_ATOMIC = 99_999_999_999_999_999_999n
export type CollectionFloorInput = string | bigint | null | undefined

export function normalizeCollectionFloorAtomic(value: CollectionFloorInput): bigint | null {
  if (value == null) return null
  if (typeof value !== 'bigint' && (typeof value !== 'string' || !/^[0-9]+$/.test(value))) {
    throw new Error('COLLECTION_FLOOR_INVALID')
  }
  const amount = BigInt(value)
  if (amount < 0n || amount > MAX_COLLECTION_FLOOR_ATOMIC) throw new Error('COLLECTION_FLOOR_INVALID')
  return amount
}

export function isBelowCollectionFloor(priceAtomic: bigint, floorPriceAtomic: CollectionFloorInput): boolean {
  const floor = normalizeCollectionFloorAtomic(floorPriceAtomic)
  return floor !== null && priceAtomic < floor
}
