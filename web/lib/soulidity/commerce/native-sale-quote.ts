/** Mirrors economics::native_sale_quote. This is a preview, never chain proof.
 * The legacy Animacraft gross/FLOOR quote must remain limited to old operations.
 * Rates must come from the pinned Config/Offer, never product metadata.
 */
export function quoteNativeSale(ask: bigint, rates: {
  secondaryBps: number; creatorBps: number; collectionBps: number
}) {
  const values = [rates.secondaryBps, rates.creatorBps, rates.collectionBps]
  if (typeof ask !== 'bigint' || ask <= 0n || ask > MAX_U64
    || values.some(v => !Number.isInteger(v) || v < 0 || v > 10000)
    || values.reduce((a, b) => a + b, 0) > 10000) throw new Error('Invalid Native sale ask or rates')
  const ceil = (bps: number) => (ask * BigInt(bps) + 9999n) / 10000n
  const platform = ceil(rates.secondaryBps)
  const creator = ceil(rates.creatorBps)
  const collection = ceil(rates.collectionBps)
  const total = ask + platform + creator + collection
  if (total > MAX_U64) throw new Error('Native sale total exceeds u64')
  return { ask, platform, creator, collection, total }
}

const MAX_U64 = (1n << 64n) - 1n

/** Native settlement pays royalties directly and retains only platform income.
 * When seller is also a royalty recipient that part stays in the seller coin.
 * Keep components visible even when recipients coincide.
 */
export function nativeSaleDistribution(quote: ReturnType<typeof quoteNativeSale>, recipients: {
  seller: string; creator: string; collection: string
}) {
  if ([quote.ask, quote.platform, quote.creator, quote.collection, quote.total].some(v => typeof v !== 'bigint' || v < 0n || v > MAX_U64)
    || quote.ask === 0n || quote.ask + quote.platform + quote.creator + quote.collection !== quote.total) {
    throw new Error('Invalid Native settlement amounts')
  }
  const address = /^0x[0-9a-f]{64}$/
  for (const key of ['seller', 'creator', 'collection'] as const) {
    const value = recipients[key]
    if (!address.test(value) || (BigInt(value) === 0n && (key !== 'collection' || quote.collection > 0n))) {
      throw new Error('Invalid Native settlement recipient')
    }
  }
  const creatorTransfer = recipients.creator === recipients.seller ? 0n : quote.creator
  const collectionTransfer = recipients.collection === recipients.seller ? 0n : quote.collection
  return { sellerTransfer: quote.total - quote.platform - creatorTransfer - collectionTransfer,
    creatorTransfer, collectionTransfer, protocolIncome: quote.platform }
}
