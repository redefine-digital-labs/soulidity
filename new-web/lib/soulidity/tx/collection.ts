import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { buildBuyerKioskArgs, finishBuyerKioskArgs, validateCollectionArgs } from '@/lib/soulidity/tx/shared'

type CreateCollectionTxParams = {
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  name: string
  description: string
  imageUrl: string
  extraRoyaltyBps: number
  tradeable: boolean
}

type AddSoulToCollectionTxParams = {
  collectionObjectId: string
  stateObjectId: string
}

export function buildCreateCollectionTx(params: CreateCollectionTxParams) {
  validateCollectionArgs(params)

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const collectionPolicyId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })
  tx.moveCall({
    target: `${packageId}::market::create_collection_in_personal_kiosk`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(collectionPolicyId),
      personalKiosk.buyerKiosk,
      personalKiosk.buyerKioskCap,
      tx.pure.string(params.name),
      tx.pure.string(params.description),
      tx.pure.string(params.imageUrl),
      tx.pure.u16(params.extraRoyaltyBps),
      tx.pure.bool(params.tradeable),
    ],
  })

  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}

export function buildAddSoulToCollectionTx(params: AddSoulToCollectionTxParams) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::collection::add_soul`,
    arguments: [
      tx.object(params.collectionObjectId),
      tx.object(params.stateObjectId),
    ],
  })
  return tx
}
