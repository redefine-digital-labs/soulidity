import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'

export function buildListSoulTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  stateObjectId: string
  soulObjectId: string
  priceAtomic: bigint
  collectionObjectId?: string | null
}) {
  if (params.priceAtomic <= 0n) {
    throw new Error('priceAtomic must be positive')
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::market::ensure_personal_kiosk_registered`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.currentKioskCapOnChainId),
    ],
  })

  if (params.collectionObjectId) {
    tx.moveCall({
      target: `${packageId}::market::list_soul_fixed_price_with_collection`,
      arguments: [
        tx.object(marketConfigId),
        tx.object(kioskRegistryId),
        tx.object(params.collectionObjectId),
        tx.object(params.currentKioskId),
        tx.object(params.currentKioskCapOnChainId),
        tx.object(params.stateObjectId),
        tx.pure.id(params.soulObjectId),
        tx.pure.u64(params.priceAtomic),
      ],
    })
  } else {
    tx.moveCall({
      target: `${packageId}::market::list_soul_fixed_price`,
      arguments: [
        tx.object(marketConfigId),
        tx.object(kioskRegistryId),
        tx.object(params.currentKioskId),
        tx.object(params.currentKioskCapOnChainId),
        tx.object(params.stateObjectId),
        tx.pure.id(params.soulObjectId),
        tx.pure.u64(params.priceAtomic),
      ],
    })
  }

  return tx
}

export function buildListCollectionTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  collectionObjectId: string
  rightObjectId: string
  priceAtomic: bigint
}) {
  if (params.priceAtomic <= 0n) {
    throw new Error('priceAtomic must be positive')
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::market::ensure_personal_kiosk_registered`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.currentKioskCapOnChainId),
    ],
  })
  tx.moveCall({
    target: `${packageId}::market::list_collection_right_fixed_price`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.collectionObjectId),
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.pure.id(params.rightObjectId),
      tx.pure.u64(params.priceAtomic),
    ],
  })

  return tx
}

