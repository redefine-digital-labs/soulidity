import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'
import { buildBuyerKioskArgs, finishBuyerKioskArgs } from './shared'

export function buildExactPaymentCoin(
  tx: Transaction,
  paymentCoinObjectIds: string[],
  totalAtomic: bigint,
) {
  if (totalAtomic <= 0n) {
    throw new Error('totalAtomic must be positive')
  }
  if (paymentCoinObjectIds.length === 0) {
    throw new Error('paymentCoinObjectIds must contain at least one object id')
  }

  const [primaryCoinId, ...remainingCoinIds] = paymentCoinObjectIds
  const primaryCoin = tx.object(primaryCoinId!)
  if (remainingCoinIds.length > 0) {
    tx.mergeCoins(primaryCoin, remainingCoinIds.map((coinId) => tx.object(coinId)))
  }
  const [paymentCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(totalAtomic)])
  return paymentCoin
}

export function buildBuySoulTx(params: {
  sellerKioskId: string
  stateObjectId: string
  listingObjectId: string
  totalAtomic: bigint
  paymentCoinObjectIds: string[]
  collectionObjectId?: string | null
  buyerKioskId?: string | null
  buyerKioskCapOnChainId?: string | null
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const transferPolicyId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const buyerKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.buyerKioskId,
    buyerKioskCapOnChainId: params.buyerKioskCapOnChainId,
  })
  const paymentCoin = buildExactPaymentCoin(tx, params.paymentCoinObjectIds, params.totalAtomic)

  tx.moveCall({
    target: params.collectionObjectId
      ? `${packageId}::market::buy_soul_fixed_price_with_collection_v2`
      : `${packageId}::market::buy_soul_fixed_price_v2`,
    arguments: params.collectionObjectId
      ? [
          tx.object(marketConfigId),
          tx.object(kioskRegistryId),
          tx.object(transferPolicyId),
          tx.object(params.collectionObjectId),
          tx.object(params.sellerKioskId),
          buyerKiosk.buyerKiosk,
          buyerKiosk.buyerKioskCap,
          tx.object(params.stateObjectId),
          tx.object(params.listingObjectId),
          paymentCoin,
        ]
      : [
          tx.object(marketConfigId),
          tx.object(kioskRegistryId),
          tx.object(transferPolicyId),
          tx.object(params.sellerKioskId),
          buyerKiosk.buyerKiosk,
          buyerKiosk.buyerKioskCap,
          tx.object(params.stateObjectId),
          tx.object(params.listingObjectId),
          paymentCoin,
        ],
  })

  finishBuyerKioskArgs(tx, buyerKiosk)
  return tx
}

export function buildBuyCollectionTx(params: {
  sellerKioskId: string
  collectionObjectId: string
  listingObjectId: string
  totalAtomic: bigint
  paymentCoinObjectIds: string[]
  buyerKioskId?: string | null
  buyerKioskCapOnChainId?: string | null
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const collectionPolicyId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const buyerKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.buyerKioskId,
    buyerKioskCapOnChainId: params.buyerKioskCapOnChainId,
  })
  const paymentCoin = buildExactPaymentCoin(tx, params.paymentCoinObjectIds, params.totalAtomic)

  tx.moveCall({
    target: `${packageId}::market::buy_collection_right_fixed_price_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(collectionPolicyId),
      tx.object(params.collectionObjectId),
      tx.object(params.sellerKioskId),
      buyerKiosk.buyerKiosk,
      buyerKiosk.buyerKioskCap,
      tx.object(params.listingObjectId),
      paymentCoin,
    ],
  })

  finishBuyerKioskArgs(tx, buyerKiosk)
  return tx
}
