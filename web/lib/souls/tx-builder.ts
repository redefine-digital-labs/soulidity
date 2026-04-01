import { Transaction } from '@mysten/sui/transactions'
import { getRequiredPublicEnv } from '@web/lib/souls/config'
import { getVendoredKioskPackageAddress } from '@web/lib/souls/kiosk-package'

const MAX_NAME_BYTES = 256
const MAX_DESCRIPTION_BYTES = 4096
const MAX_CATEGORY_BYTES = 64
export const MAX_TAGS = 10
const MAX_TAG_BYTES = 64
export const MAX_PREVIEW_IMAGES = 10
const MAX_PREVIEW_IMAGE_BYTES = 512
export const MAX_CREATOR_ROYALTY_BPS = 2_500

function getUtf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length
}

function assertMaxUtf8Bytes(value: string, maxBytes: number, label: string) {
  if (getUtf8ByteLength(value) > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit`)
  }
}

function validateSoulMetadata(params: {
  name: string
  description: string
  category: string
  tags: string[]
  previewImages: string[]
}) {
  if (params.name.trim().length === 0) {
    throw new Error('Soul name is required')
  }
  assertMaxUtf8Bytes(params.name, MAX_NAME_BYTES, 'Soul name')
  if (params.description.trim().length === 0) {
    throw new Error('Soul description is required')
  }
  assertMaxUtf8Bytes(params.description, MAX_DESCRIPTION_BYTES, 'Soul description')
  if (params.category.trim().length === 0) {
    throw new Error('Soul category is required')
  }
  assertMaxUtf8Bytes(params.category, MAX_CATEGORY_BYTES, 'Soul category')
  if (params.tags.length > MAX_TAGS) {
    throw new Error(`Soul tags exceed the ${MAX_TAGS}-tag limit`)
  }
  params.tags.forEach((tag) => {
    assertMaxUtf8Bytes(tag, MAX_TAG_BYTES, 'Soul tag')
  })
  if (params.previewImages.length > MAX_PREVIEW_IMAGES) {
    throw new Error(`Soul preview images exceed the ${MAX_PREVIEW_IMAGES}-item limit`)
  }
  params.previewImages.forEach((previewImage) => {
    assertMaxUtf8Bytes(previewImage, MAX_PREVIEW_IMAGE_BYTES, 'Soul preview image reference')
  })
}

function validateCreatorRoyaltyBps(creatorRoyaltyBps: number) {
  if (
    !Number.isInteger(creatorRoyaltyBps)
    || creatorRoyaltyBps < 0
    || creatorRoyaltyBps > MAX_CREATOR_ROYALTY_BPS
  ) {
    throw new Error(`creatorRoyaltyBps must be between 0 and ${MAX_CREATOR_ROYALTY_BPS}`)
  }
}

export function buildMintAndListSoulTx(params: {
  name: string
  description: string
  imageUrl: string
  metadataRef?: string | null
  contentBlobObjectId: string
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  category: string
  tags: string[]
  previewImages: string[]
  readme?: string | null
  priceAtomic: bigint
  creatorRoyaltyBps: number
}): Transaction {
  validateSoulMetadata(params)
  if (params.priceAtomic <= 0n) {
    throw new Error('priceAtomic must be positive')
  }
  validateCreatorRoyaltyBps(params.creatorRoyaltyBps)

  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  const marketConfigId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID')
  const tx = new Transaction()
  const currentKioskId = params.currentKioskId?.trim()
  const currentKioskCapOnChainId = params.currentKioskCapOnChainId?.trim()

  if ((currentKioskId && !currentKioskCapOnChainId) || (!currentKioskId && currentKioskCapOnChainId)) {
    throw new Error('currentKioskId and currentKioskCapOnChainId must be provided together')
  }

  if (currentKioskId && currentKioskCapOnChainId) {
    tx.moveCall({
      target: `${packageId}::market::ensure_personal_kiosk_registered`,
      arguments: [
        tx.object(marketConfigId),
        tx.object(currentKioskCapOnChainId),
      ],
    })
    tx.moveCall({
      target: `${packageId}::market::mint_and_list_fixed_price_in_personal_kiosk`,
      arguments: [
        tx.object(marketConfigId),
        tx.object(currentKioskId),
        tx.object(currentKioskCapOnChainId),
        tx.pure.string(params.name),
        tx.pure.string(params.description),
        tx.pure.string(params.imageUrl),
        tx.pure.option('string', params.metadataRef ?? null),
        tx.object(params.contentBlobObjectId),
        tx.pure.u64(params.priceAtomic),
        tx.pure.u16(params.creatorRoyaltyBps),
      ],
    })
  } else {
    tx.moveCall({
      target: `${packageId}::market::mint_and_list_fixed_price`,
      arguments: [
        tx.object(marketConfigId),
        tx.pure.string(params.name),
        tx.pure.string(params.description),
        tx.pure.string(params.imageUrl),
        tx.pure.option('string', params.metadataRef ?? null),
        tx.object(params.contentBlobObjectId),
        tx.pure.u64(params.priceAtomic),
        tx.pure.u16(params.creatorRoyaltyBps),
      ],
    })
  }

  return tx
}

export function buildMintOnlySoulTx(params: {
  name: string
  description: string
  imageUrl: string
  metadataRef?: string | null
  contentBlobObjectId: string
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  category: string
  tags: string[]
  previewImages: string[]
  readme?: string | null
  creatorRoyaltyBps: number
}): Transaction {
  validateSoulMetadata(params)
  validateCreatorRoyaltyBps(params.creatorRoyaltyBps)

  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  const marketConfigId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID')
  const tx = new Transaction()
  const currentKioskId = params.currentKioskId?.trim()
  const currentKioskCapOnChainId = params.currentKioskCapOnChainId?.trim()

  if ((currentKioskId && !currentKioskCapOnChainId) || (!currentKioskId && currentKioskCapOnChainId)) {
    throw new Error('currentKioskId and currentKioskCapOnChainId must be provided together')
  }

  if (currentKioskId && currentKioskCapOnChainId) {
    tx.moveCall({
      target: `${packageId}::market::ensure_personal_kiosk_registered`,
      arguments: [
        tx.object(marketConfigId),
        tx.object(currentKioskCapOnChainId),
      ],
    })
    tx.moveCall({
      target: `${packageId}::market::mint_in_personal_kiosk`,
      arguments: [
        tx.object(marketConfigId),
        tx.object(currentKioskId),
        tx.object(currentKioskCapOnChainId),
        tx.pure.string(params.name),
        tx.pure.string(params.description),
        tx.pure.string(params.imageUrl),
        tx.pure.option('string', params.metadataRef ?? null),
        tx.object(params.contentBlobObjectId),
        tx.pure.u16(params.creatorRoyaltyBps),
      ],
    })
  } else {
    tx.moveCall({
      target: `${packageId}::market::mint_to_kiosk`,
      arguments: [
        tx.object(marketConfigId),
        tx.pure.string(params.name),
        tx.pure.string(params.description),
        tx.pure.string(params.imageUrl),
        tx.pure.option('string', params.metadataRef ?? null),
        tx.object(params.contentBlobObjectId),
        tx.pure.u16(params.creatorRoyaltyBps),
      ],
    })
  }

  return tx
}

export function buildBuySoulTx(params: {
  listingObjectId: string
  sellerKioskId: string
  buyerKioskId?: string | null
  buyerKioskCapOnChainId?: string | null
  totalAtomic: bigint
  paymentCoinObjectIds: string[]
}): Transaction {
  if (params.totalAtomic <= 0n) {
    throw new Error('totalAtomic must be positive')
  }
  if (params.paymentCoinObjectIds.length === 0) {
    throw new Error('paymentCoinObjectIds must contain at least one coin object id')
  }

  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  const marketConfigId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID')
  const transferPolicyId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID')
  const allowlistRegistryId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID')
  const kioskPackageId = getVendoredKioskPackageAddress()
  const tx = new Transaction()
  const buyerKioskId = params.buyerKioskId?.trim()
  const buyerKioskCapOnChainId = params.buyerKioskCapOnChainId?.trim()
  if ((buyerKioskId && !buyerKioskCapOnChainId) || (!buyerKioskId && buyerKioskCapOnChainId)) {
    throw new Error('buyerKioskId and buyerKioskCapOnChainId must be provided together')
  }

  let buyerKioskArg
  let buyerKioskCapArg
  if (buyerKioskId && buyerKioskCapOnChainId) {
    buyerKioskArg = tx.object(buyerKioskId)
    buyerKioskCapArg = tx.object(buyerKioskCapOnChainId)
    tx.moveCall({
      target: `${packageId}::market::ensure_personal_kiosk_registered`,
      arguments: [
        tx.object(marketConfigId),
        buyerKioskCapArg,
      ],
    })
  } else {
    const [buyerKiosk, kioskOwnerCap] = tx.moveCall({
      target: '0x2::kiosk::new',
      arguments: [],
    })
    const [buyerPersonalKioskCap] = tx.moveCall({
      target: `${kioskPackageId}::personal_kiosk::new`,
      arguments: [buyerKiosk, kioskOwnerCap],
    })
    tx.moveCall({
      target: `${packageId}::market::register_existing_personal_kiosk`,
      arguments: [
        tx.object(marketConfigId),
        buyerPersonalKioskCap,
      ],
    })
    buyerKioskArg = buyerKiosk
    buyerKioskCapArg = buyerPersonalKioskCap
  }

  const [primaryCoinId, ...remainingCoinIds] = params.paymentCoinObjectIds
  const primaryCoin = tx.object(primaryCoinId!)
  if (remainingCoinIds.length > 0) {
    tx.mergeCoins(primaryCoin, remainingCoinIds.map((coinId) => tx.object(coinId)))
  }
  const [paymentCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(params.totalAtomic)])

  tx.moveCall({
    target: `${packageId}::market::buy_fixed_price`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(transferPolicyId),
      tx.object(allowlistRegistryId),
      tx.object(params.sellerKioskId),
      buyerKioskArg,
      buyerKioskCapArg,
      tx.object(params.listingObjectId),
      paymentCoin,
    ],
  })

  if (!buyerKioskId || !buyerKioskCapOnChainId) {
    tx.moveCall({
      target: '0x2::transfer::public_share_object',
      typeArguments: ['0x2::kiosk::Kiosk'],
      arguments: [buyerKioskArg],
    })
    tx.moveCall({
      target: `${kioskPackageId}::personal_kiosk::transfer_to_sender`,
      arguments: [buyerKioskCapArg],
    })
  }
  return tx
}

export function buildInitSoulPersonalKioskTx(params?: {
  currentKioskCapOnChainId?: string | null
}): Transaction {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  const marketConfigId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID')
  const tx = new Transaction()
  const currentKioskCapOnChainId = params?.currentKioskCapOnChainId?.trim()

  if (currentKioskCapOnChainId) {
    tx.moveCall({
      target: `${packageId}::market::ensure_personal_kiosk_registered`,
      arguments: [tx.object(marketConfigId), tx.object(currentKioskCapOnChainId)],
    })
    tx.moveCall({
      target: `${packageId}::market::reuse_personal_kiosk`,
      arguments: [tx.object(marketConfigId), tx.object(currentKioskCapOnChainId)],
    })
  } else {
    tx.moveCall({
      target: `${packageId}::market::init_personal_kiosk`,
      arguments: [tx.object(marketConfigId)],
    })
  }

  return tx
}

export function buildListHeldSoulTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  soulObjectId: string
  priceAtomic: bigint
}): Transaction {
  if (params.priceAtomic <= 0n) {
    throw new Error('priceAtomic must be positive')
  }

  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  const marketConfigId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID')
  const allowlistRegistryId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID')
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::market::ensure_personal_kiosk_registered`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(params.currentKioskCapOnChainId),
    ],
  })
  tx.moveCall({
    target: `${packageId}::market::list_fixed_price`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(allowlistRegistryId),
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.pure.id(params.soulObjectId),
      tx.pure.u64(params.priceAtomic),
    ],
  })

  return tx
}

export function buildCancelListingTx(params: {
  currentKioskId: string
  currentKioskCapOnChainId: string
  listingObjectId: string
}): Transaction {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::market::cancel_listing`,
    arguments: [
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.object(params.listingObjectId),
    ],
  })

  return tx
}

export function buildSetAllowlistAddressTx(params: {
  soulObjectId: string
  currentKioskId: string
  currentKioskCapOnChainId: string
  allowlistAddress: string
}): Transaction {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  const allowlistRegistryId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID')
  const tx = new Transaction()
  const [accessCap] = tx.moveCall({
    target: `${packageId}::allowlist::set_allowlist_address_via_personal_kiosk`,
    arguments: [
      tx.object(allowlistRegistryId),
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.pure.id(params.soulObjectId),
      tx.pure.address(params.allowlistAddress),
    ],
  })
  tx.transferObjects([accessCap], tx.pure.address(params.allowlistAddress))
  return tx
}

export function buildClearAllowlistAddressTx(params: {
  soulObjectId: string
  currentKioskId: string
  currentKioskCapOnChainId: string
}): Transaction {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  const allowlistRegistryId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::allowlist::clear_allowlist_address_via_personal_kiosk`,
    arguments: [
      tx.object(allowlistRegistryId),
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.pure.id(params.soulObjectId),
    ],
  })
  return tx
}
