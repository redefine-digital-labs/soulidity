import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'

/** Cancel current collection listing + relist at new price in a single transaction. */
export function buildUpdateCollectionListingPriceTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  collectionObjectId: string
  listingObjectId: string
  newPriceAtomic: bigint
}) {
  if (params.newPriceAtomic <= 0n) {
    throw new Error('newPriceAtomic must be positive')
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const tx = new Transaction()

  // Step 1: Cancel current listing
  tx.moveCall({
    target: `${packageId}::market::cancel_collection_listing`,
    arguments: [
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.object(params.listingObjectId),
    ],
  })

  // Step 2: Ensure kiosk is registered
  tx.moveCall({
    target: `${packageId}::market::ensure_personal_kiosk_registered_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.currentKioskCapOnChainId),
    ],
  })

  // Step 3: Relist at new price and share the returned listing object.
  const listing = tx.moveCall({
    target: `${packageId}::market::list_collection_right_fixed_price_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.collectionObjectId),
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.pure.u64(params.newPriceAtomic),
    ],
  })
  tx.moveCall({
    target: `${packageId}::market::finalize_collection_listing`,
    arguments: [listing],
  })

  return tx
}
