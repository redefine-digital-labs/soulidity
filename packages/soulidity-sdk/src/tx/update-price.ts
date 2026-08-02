import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'

/** Delist + relist in a single transaction to update the listing price. */
export function buildUpdateListingPriceTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  stateObjectId: string
  listingObjectId: string
  newPriceAtomic: bigint
  collectionObjectId?: string | null
  animacraftProvenanceObjectId?: string | null
  animacraftVersion?: number | null
}) {
  if (params.newPriceAtomic <= 0n) {
    throw new Error('newPriceAtomic must be positive')
  }
  const isAnimacraftV5 = params.animacraftVersion === 5
  if (params.animacraftVersion === 6) {
    throw new Error('Animacraft v6 listing price updates are disabled; cancel the v6 listing and create a fresh one')
  }
  if (params.animacraftVersion != null && params.animacraftVersion !== 4 && !isAnimacraftV5) {
    throw new Error(`Unsupported Animacraft protocol version ${params.animacraftVersion}`)
  }
  if (isAnimacraftV5 && !params.animacraftProvenanceObjectId) {
    throw new Error('Animacraft v5 price update requires provenance')
  }
  if (isAnimacraftV5 && params.collectionObjectId) {
    throw new Error('Collection-bound Animacraft v5 Souls cannot update their listing price')
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const isAnimacraft = Boolean(params.animacraftProvenanceObjectId)
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const tx = new Transaction()

  // Step 1: Cancel current listing
  tx.moveCall({
    target: `${packageId}::market::cancel_soul_listing`,
    arguments: [
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.object(params.stateObjectId),
      tx.object(params.listingObjectId),
    ],
  })

  // Step 2: Repair stale market registry bindings before relisting.
  tx.moveCall({
    target: `${packageId}::market::ensure_personal_kiosk_registered_v6`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.currentKioskCapOnChainId),
    ],
  })

  // Step 3: Relist at new price and share the returned listing object.
  let listing: ReturnType<Transaction['moveCall']>
  if (isAnimacraftV5) {
    listing = tx.moveCall({
      target: `${packageId}::market::list_animacraft_v5_soul_fixed_price_v6`,
      arguments: [
        tx.object(marketConfigId),
        tx.object(kioskRegistryId),
        tx.object(params.animacraftProvenanceObjectId!),
        tx.object(params.currentKioskId),
        tx.object(params.currentKioskCapOnChainId),
        tx.object(params.stateObjectId),
        tx.pure.u64(params.newPriceAtomic),
      ],
    })
  } else if (params.animacraftProvenanceObjectId) {
    listing = params.collectionObjectId
      ? tx.moveCall({
          target: `${packageId}::market::list_animacraft_soul_fixed_price_with_collection_v6`,
          arguments: [
            tx.object(marketConfigId),
            tx.object(kioskRegistryId),
            tx.object(params.animacraftProvenanceObjectId),
            tx.object(params.collectionObjectId),
            tx.object(params.currentKioskId),
            tx.object(params.currentKioskCapOnChainId),
            tx.object(params.stateObjectId),
            tx.pure.u64(params.newPriceAtomic),
          ],
        })
      : tx.moveCall({
          target: `${packageId}::market::list_animacraft_soul_fixed_price_v6`,
          arguments: [
            tx.object(marketConfigId),
            tx.object(kioskRegistryId),
            tx.object(params.animacraftProvenanceObjectId),
            tx.object(params.currentKioskId),
            tx.object(params.currentKioskCapOnChainId),
            tx.object(params.stateObjectId),
            tx.pure.u64(params.newPriceAtomic),
          ],
        })
  } else {
    listing = params.collectionObjectId
      ? tx.moveCall({
          target: `${packageId}::market::list_soul_fixed_price_with_collection_v6`,
          arguments: [
            tx.object(marketConfigId),
            tx.object(kioskRegistryId),
            tx.object(params.collectionObjectId),
            tx.object(params.currentKioskId),
            tx.object(params.currentKioskCapOnChainId),
            tx.object(params.stateObjectId),
            tx.pure.u64(params.newPriceAtomic),
          ],
        })
      : tx.moveCall({
          target: `${packageId}::market::list_soul_fixed_price_v6`,
          arguments: [
            tx.object(marketConfigId),
            tx.object(kioskRegistryId),
            tx.object(params.currentKioskId),
            tx.object(params.currentKioskCapOnChainId),
            tx.object(params.stateObjectId),
            tx.pure.u64(params.newPriceAtomic),
          ],
        })
  }

  tx.moveCall({
    target: `${packageId}::market::finalize_soul_listing`,
    arguments: [listing],
  })

  return tx
}
