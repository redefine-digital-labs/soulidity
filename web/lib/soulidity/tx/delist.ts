import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'

export function buildDelistSoulTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  stateObjectId: string
  listingObjectId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
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

export function buildDelistCollectionTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  listingObjectId: string
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
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
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
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
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::delete_collection_listing`,
    arguments: [
      tx.object(params.listingObjectId),
    ],
  })
  return tx
}

