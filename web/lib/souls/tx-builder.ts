import { Transaction } from '@mysten/sui/transactions'
import { getRequiredPublicEnv } from '@web/lib/souls/config'

const KIOSK_PACKAGE_ID = '0x2'
const MAX_NAME_BYTES = 256
const MAX_DESCRIPTION_BYTES = 4096
const MAX_CATEGORY_BYTES = 64
const MAX_TAGS = 10
const MAX_TAG_BYTES = 64
const MAX_PREVIEW_IMAGES = 10
const MAX_PREVIEW_IMAGE_BYTES = 512

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

export function buildMintAndListSoulTx(params: {
  ownerAddress: string
  name: string
  description: string
  imageUrl: string
  metadataRef?: string | null
  contentBlobObjectId: string
  category: string
  tags: string[]
  previewImages: string[]
  readme?: string | null
  priceSui: bigint
}): Transaction {
  validateSoulMetadata(params)
  if (params.priceSui <= 0n) {
    throw new Error('priceSui must be positive')
  }

  const adapterPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID')
  const collectionId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_UNFT_COLLECTION_ID')
  const marketplaceId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_CPU_MARKETPLACE_ID')
  const tx = new Transaction()

  const [kiosk, kioskOwnerCap] = tx.moveCall({
    target: `${KIOSK_PACKAGE_ID}::kiosk::new`,
  })

  tx.moveCall({
    target: `${adapterPackageId}::market::mint_and_list`,
    arguments: [
      tx.object(collectionId),
      kiosk,
      kioskOwnerCap,
      tx.object(marketplaceId),
      tx.pure.string(params.name),
      tx.pure.string(params.description),
      tx.pure.string(params.imageUrl),
      tx.pure.option('string', params.metadataRef ?? null),
      tx.object(params.contentBlobObjectId),
      tx.pure.u64(params.priceSui),
    ],
  })

  tx.moveCall({
    target: `${KIOSK_PACKAGE_ID}::transfer::public_share_object`,
    typeArguments: [`${KIOSK_PACKAGE_ID}::kiosk::Kiosk`],
    arguments: [kiosk],
  })
  tx.transferObjects([kioskOwnerCap], tx.pure.address(params.ownerAddress))

  return tx
}

export function buildBuySoulTx(params: {
  soulObjectId: string
  sellerKioskId: string
  buyerAddress: string
  priceSui: bigint
  feeAmountSui: bigint
}): Transaction {
  if (params.priceSui <= 0n) {
    throw new Error('priceSui must be positive')
  }
  if (params.feeAmountSui < 0n) {
    throw new Error('feeAmountSui must be non-negative')
  }

  const adapterPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID')
  const collectionId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_UNFT_COLLECTION_ID')
  const marketplaceId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_CPU_MARKETPLACE_ID')
  const transferPolicyId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const [paymentCoin, feeCoin] = tx.splitCoins(tx.gas, [
    tx.pure.u64(params.priceSui),
    tx.pure.u64(params.feeAmountSui),
  ])
  const [purchasedSoul, feeRemainder] = tx.moveCall({
    target: `${adapterPackageId}::market::purchase`,
    arguments: [
      tx.object(collectionId),
      tx.object(marketplaceId),
      tx.object(transferPolicyId),
      tx.object(params.sellerKioskId),
      tx.object(params.soulObjectId),
      paymentCoin,
      feeCoin,
    ],
  })
  tx.transferObjects([purchasedSoul], tx.pure.address(params.buyerAddress))
  tx.mergeCoins(tx.gas, [feeRemainder])
  return tx
}

export function buildBuySecondarySoulTx(params: {
  soulObjectId: string
  sellerKioskId: string
  buyerAddress: string
  priceSui: bigint
  feeAmountSui: bigint
}): Transaction {
  if (params.priceSui <= 0n) {
    throw new Error('priceSui must be positive')
  }
  if (params.feeAmountSui < 0n) {
    throw new Error('feeAmountSui must be non-negative')
  }

  const soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  const marketConfigId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID')
  const transferPolicyId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const [paymentCoin, feeCoin] = tx.splitCoins(tx.gas, [
    tx.pure.u64(params.priceSui),
    tx.pure.u64(params.feeAmountSui),
  ])
  const [purchasedSoul, feeRemainder] = tx.moveCall({
    target: `${soulPackageId}::market::purchase`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(transferPolicyId),
      tx.object(params.sellerKioskId),
      tx.object(params.soulObjectId),
      paymentCoin,
      feeCoin,
    ],
  })
  tx.transferObjects([purchasedSoul], tx.pure.address(params.buyerAddress))
  tx.mergeCoins(tx.gas, [feeRemainder])
  return tx
}

export function buildListHeldSoulTx(params: {
  ownerAddress: string
  soulObjectId: string
  priceSui: bigint
}): Transaction {
  if (params.priceSui <= 0n) {
    throw new Error('priceSui must be positive')
  }

  const soulPackageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  const transferPolicyId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID')
  const tx = new Transaction()

  const [kiosk, kioskOwnerCap] = tx.moveCall({
    target: `${KIOSK_PACKAGE_ID}::kiosk::new`,
  })

  tx.moveCall({
    target: `${soulPackageId}::market::place_and_list`,
    arguments: [
      kiosk,
      kioskOwnerCap,
      tx.object(transferPolicyId),
      tx.object(params.soulObjectId),
      tx.pure.u64(params.priceSui),
    ],
  })

  tx.moveCall({
    target: `${KIOSK_PACKAGE_ID}::transfer::public_share_object`,
    typeArguments: [`${KIOSK_PACKAGE_ID}::kiosk::Kiosk`],
    arguments: [kiosk],
  })
  tx.transferObjects([kioskOwnerCap], tx.pure.address(params.ownerAddress))

  return tx
}

export function buildSetAgentGrantTx(params: {
  soulObjectId: string
  agentAddress: string
}): Transaction {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  const tx = new Transaction()
  const [accessCap] = tx.moveCall({
    target: `${packageId}::grant::set_agent_grant`,
    arguments: [
      tx.object(params.soulObjectId),
      tx.pure.address(params.agentAddress),
    ],
  })
  tx.transferObjects([accessCap], tx.pure.address(params.agentAddress))
  return tx
}

export function buildRevokeAgentGrantTx(params: {
  soulObjectId: string
}): Transaction {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::grant::revoke_agent_grant`,
    arguments: [tx.object(params.soulObjectId)],
  })
  return tx
}
