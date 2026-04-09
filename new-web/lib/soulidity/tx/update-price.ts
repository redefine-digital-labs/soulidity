import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'

/** Delist + relist in a single transaction to update the listing price. */
export function buildUpdateListingPriceTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  stateObjectId: string
  soulObjectId: string
  listingObjectId: string
  newPriceAtomic: bigint
  collectionObjectId?: string | null
}) {
  if (params.newPriceAtomic <= 0n) {
    throw new Error('newPriceAtomic must be positive')
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const tx = new Transaction()

  // Step 1: Cancel current listing
  tx.moveCall({
    target: `${packageId}::market::cancel_soul_listing`,
    arguments: [
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.object(params.listingObjectId),
    ],
  })

  // Step 2: Repair stale market registry bindings before relisting.
  tx.moveCall({
    target: `${packageId}::market::ensure_personal_kiosk_registered`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(params.currentKioskCapOnChainId),
    ],
  })

  // Step 3: Relist at new price
  if (params.collectionObjectId) {
    tx.moveCall({
      target: `${packageId}::market::list_soul_fixed_price_with_collection`,
      arguments: [
        tx.object(marketConfigId),
        tx.object(params.collectionObjectId),
        tx.object(params.currentKioskId),
        tx.object(params.currentKioskCapOnChainId),
        tx.object(params.stateObjectId),
        tx.pure.id(params.soulObjectId),
        tx.pure.u64(params.newPriceAtomic),
      ],
    })
  } else {
    tx.moveCall({
      target: `${packageId}::market::list_soul_fixed_price`,
      arguments: [
        tx.object(marketConfigId),
        tx.object(params.currentKioskId),
        tx.object(params.currentKioskCapOnChainId),
        tx.object(params.stateObjectId),
        tx.pure.id(params.soulObjectId),
        tx.pure.u64(params.newPriceAtomic),
      ],
    })
  }

  return tx
}
