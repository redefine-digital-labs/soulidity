import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'

/**
 * Build a standalone "list this soul that's already minted and shared" PTB.
 *
 * The list ABI no longer takes the soul_id as a u64 — Move now reads it
 * off the passed `&SoulState`. Both the no-collection and with-collection
 * branches finalize the returned `SoulListing` by calling
 * `market::finalize_soul_listing` last so the listing object is shared.
 */
export function buildListSoulTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  stateObjectId: string
  priceAtomic: bigint
  collectionObjectId?: string | null
  animacraftProvenanceObjectId?: string | null
  animacraftVersion?: number | null
}) {
  if (params.animacraftProvenanceObjectId != null || params.animacraftVersion != null) {
    throw new Error('Animacraft listings require the native V8 market builder; legacy provenance is unsupported')
  }
  if (params.priceAtomic <= 0n) {
    throw new Error('priceAtomic must be positive')
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::market::ensure_personal_kiosk_registered_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.currentKioskCapOnChainId),
    ],
  })

  const listing = params.collectionObjectId
    ? tx.moveCall({
        target: `${packageId}::market::list_soul_fixed_price_with_collection_v2`,
        arguments: [
          tx.object(marketConfigId),
          tx.object(kioskRegistryId),
          tx.object(params.collectionObjectId),
          tx.object(params.currentKioskId),
          tx.object(params.currentKioskCapOnChainId),
          tx.object(params.stateObjectId),
          tx.pure.u64(params.priceAtomic),
        ],
      })
    : tx.moveCall({
        target: `${packageId}::market::list_soul_fixed_price_v2`,
        arguments: [
          tx.object(marketConfigId),
          tx.object(kioskRegistryId),
          tx.object(params.currentKioskId),
          tx.object(params.currentKioskCapOnChainId),
          tx.object(params.stateObjectId),
          tx.pure.u64(params.priceAtomic),
        ],
      })

  tx.moveCall({
    target: `${packageId}::market::finalize_soul_listing`,
    arguments: [listing],
  })

  return tx
}

/**
 * Build a standalone "list collection-right that's already minted and
 * shared" PTB. Move now derives `right_id` off the passed `&SoulCollection`,
 * and the returned `CollectionListing` is finalized by
 * `market::finalize_collection_listing`.
 */
export interface CollectionTransactionTarget { packageId: string; marketConfigId: string; kioskRegistryId: string }

export function buildListCollectionTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  collectionObjectId: string
  priceAtomic: bigint
}, target?: CollectionTransactionTarget, tx = new Transaction()) {
  if (params.priceAtomic <= 0n) {
    throw new Error('priceAtomic must be positive')
  }

  const packageId = target?.packageId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const marketConfigId = target?.marketConfigId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')
  const kioskRegistryId = target?.kioskRegistryId ?? getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')

  tx.moveCall({
    target: `${packageId}::market::ensure_personal_kiosk_registered_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.currentKioskCapOnChainId),
    ],
  })
  const listing = tx.moveCall({
    target: `${packageId}::market::list_collection_right_fixed_price_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.collectionObjectId),
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.pure.u64(params.priceAtomic),
    ],
  })
  tx.moveCall({
    target: `${packageId}::market::finalize_collection_listing`,
    arguments: [listing],
  })

  return tx
}
