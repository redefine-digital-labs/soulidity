import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'

export function buildDelistSoulTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  stateObjectId: string
  listingObjectId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::cancel_soul_listing`,
    arguments: [
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.object(params.stateObjectId),
      tx.object(params.listingObjectId),
    ],
  })
  return tx
}

/**
 * Recovery path for the dedicated v6 listing. It intentionally takes no
 * MarketConfig, so an owner can always cancel while every release gate is
 * paused. The live appearance prevents cancelling a mismatched listing.
 */
export function buildDelistAnimacraftV6SoulTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  stateObjectId: string
  appearanceObjectId: string
  listingObjectId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::cancel_animacraft_v6_soul_listing`,
    arguments: [
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.object(params.stateObjectId),
      tx.object(params.appearanceObjectId),
      tx.object(params.listingObjectId),
    ],
  })
  return tx
}

/**
 * Recovery-safe v7 cancellation. It unlocks the exact wardrobe and returns
 * the kiosk purchase capability in the same PTB; no market gate is required.
 */
export function buildDelistAnimacraftV7SoulTx(params: {
  physicalConfigObjectId: string
  physicalProfileObjectId: string
  currentKioskId: string
  currentKioskCapOnChainId: string
  stateObjectId: string
  wardrobeObjectId: string
  listingObjectId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::cancel_animacraft_v7_soul_listing`,
    arguments: [
      tx.object(params.physicalConfigObjectId),
      tx.object(params.physicalProfileObjectId),
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.object(params.stateObjectId),
      tx.object(params.wardrobeObjectId),
      tx.object(params.listingObjectId),
    ],
  })
  return tx
}

export function buildDelistCollectionTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  listingObjectId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::cancel_collection_listing`,
    arguments: [
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.object(params.listingObjectId),
    ],
  })
  return tx
}

export function buildDeleteSoulListingTx(params: {
  listingObjectId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::delete_soul_listing`,
    arguments: [
      tx.object(params.listingObjectId),
    ],
  })
  return tx
}

export function buildDeleteCollectionListingTx(params: {
  listingObjectId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::delete_collection_listing`,
    arguments: [
      tx.object(params.listingObjectId),
    ],
  })
  return tx
}
