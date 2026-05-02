import { Transaction, type TransactionArgument } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { getKioskPackageAddress } from '@/lib/soulidity/kiosk'

export const MAX_NAME_BYTES = 256
export const MAX_DESCRIPTION_BYTES = 4096
export const MAX_IMAGE_URL_BYTES = 1024
export const MAX_CREATOR_ROYALTY_BPS = 2_500
export const MAX_COLLECTION_ROYALTY_BPS = 2_500

export function getUtf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length
}

function assertMaxUtf8Bytes(value: string, maxBytes: number, label: string) {
  if (getUtf8ByteLength(value) > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit`)
  }
}

export function validateSoulPublishArgs(params: {
  name: string
  description: string
  imageUrl: string
  creatorRoyaltyBps: number
}) {
  if (params.name.trim().length === 0) {
    throw new Error('Soul name is required')
  }
  if (params.description.trim().length === 0) {
    throw new Error('Soul description is required')
  }
  if (params.imageUrl.trim().length === 0) {
    throw new Error('Soul image URL is required')
  }
  assertMaxUtf8Bytes(params.name, MAX_NAME_BYTES, 'Soul name')
  assertMaxUtf8Bytes(params.description, MAX_DESCRIPTION_BYTES, 'Soul description')
  assertMaxUtf8Bytes(params.imageUrl, MAX_IMAGE_URL_BYTES, 'Soul image URL')

  if (
    !Number.isInteger(params.creatorRoyaltyBps)
    || params.creatorRoyaltyBps < 0
    || params.creatorRoyaltyBps > MAX_CREATOR_ROYALTY_BPS
  ) {
    throw new Error(`creatorRoyaltyBps must be between 0 and ${MAX_CREATOR_ROYALTY_BPS}`)
  }
}

export function assertNoMintTimeVoiceAsset(params: { initialVoice?: unknown; assetType?: unknown }) {
  if (params.initialVoice != null || params.assetType === 'audio') {
    throw new Error('Mint-time voice assets are disabled; add voice assets after mint so private asset sidecars can be mirrored safely')
  }
}

export function validateCollectionArgs(params: {
  name: string
  description: string
  imageUrl: string
  extraRoyaltyBps: number
}) {
  if (params.name.trim().length === 0) {
    throw new Error('Collection name is required')
  }
  if (params.description.trim().length === 0) {
    throw new Error('Collection description is required')
  }
  if (params.imageUrl.trim().length === 0) {
    throw new Error('Collection image URL is required')
  }
  assertMaxUtf8Bytes(params.name, MAX_NAME_BYTES, 'Collection name')
  assertMaxUtf8Bytes(params.description, MAX_DESCRIPTION_BYTES, 'Collection description')
  assertMaxUtf8Bytes(params.imageUrl, MAX_IMAGE_URL_BYTES, 'Collection image URL')

  if (
    !Number.isInteger(params.extraRoyaltyBps)
    || params.extraRoyaltyBps < 0
    || params.extraRoyaltyBps > MAX_COLLECTION_ROYALTY_BPS
  ) {
    throw new Error(`extraRoyaltyBps must be between 0 and ${MAX_COLLECTION_ROYALTY_BPS}`)
  }
}

export function buildBuyerKioskArgs(tx: Transaction, params: {
  buyerKioskId?: string | null
  buyerKioskCapOnChainId?: string | null
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const kioskPackageId = getKioskPackageAddress()
  const buyerKioskId = params.buyerKioskId?.trim()
  const buyerKioskCapOnChainId = params.buyerKioskCapOnChainId?.trim()

  if ((buyerKioskId && !buyerKioskCapOnChainId) || (!buyerKioskId && buyerKioskCapOnChainId)) {
    throw new Error('buyerKioskId and buyerKioskCapOnChainId must be provided together')
  }

  if (buyerKioskId && buyerKioskCapOnChainId) {
    tx.moveCall({
      target: `${packageId}::market::ensure_personal_kiosk_registered`,
      arguments: [
        tx.object(marketConfigId),
        tx.object(kioskRegistryId),
        tx.object(buyerKioskCapOnChainId),
      ],
    })

    return {
      buyerKiosk: tx.object(buyerKioskId),
      buyerKioskCap: tx.object(buyerKioskCapOnChainId),
      needsTransfer: false,
      kioskPackageId,
    }
  }

  const [buyerKiosk, kioskOwnerCap] = tx.moveCall({
    target: '0x2::kiosk::new',
    arguments: [],
  })
  const [buyerPersonalKioskCap] = tx.moveCall({
    target: `${kioskPackageId}::personal_kiosk::new`,
    arguments: [buyerKiosk, kioskOwnerCap],
  })

  tx.moveCall({
    target: `${packageId}::market::ensure_personal_kiosk_registered`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      buyerPersonalKioskCap,
    ],
  })

  return {
    buyerKiosk,
    buyerKioskCap: buyerPersonalKioskCap,
    needsTransfer: true,
    kioskPackageId,
  }
}

export function finishBuyerKioskArgs(tx: Transaction, params: {
  buyerKiosk: TransactionArgument
  buyerKioskCap: TransactionArgument
  needsTransfer: boolean
  kioskPackageId: string
}) {
  if (!params.needsTransfer) {
    return
  }

  tx.moveCall({
    target: '0x2::transfer::public_share_object',
    typeArguments: ['0x2::kiosk::Kiosk'],
    arguments: [params.buyerKiosk],
  })
  tx.moveCall({
    target: `${params.kioskPackageId}::personal_kiosk::transfer_to_sender`,
    arguments: [params.buyerKioskCap],
  })
}
