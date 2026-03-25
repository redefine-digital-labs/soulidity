/**
 * Transaction builders for soul_market Move contract calls.
 * Each function returns a Transaction ready for signing.
 */

import { Transaction } from '@mysten/sui/transactions'
import { getRequiredPublicEnv } from '@web/lib/souls/config'

const CLOCK = '0x6'
const MAX_NAME_BYTES = 256
const MAX_DESCRIPTION_BYTES = 4096
const MAX_CATEGORY_BYTES = 64
const MAX_TAGS = 10
const MAX_TAG_BYTES = 64
const MAX_PREVIEW_IMAGES = 10
const MAX_PREVIEW_IMAGE_BYTES = 512

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function assertMaxUtf8Bytes(value: string, maxBytes: number, label: string) {
  if (getUtf8ByteLength(value) > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit`)
  }
}

function validateCreateSeriesParams(params: {
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

// ─── Series ────────────────────────────────────────────────────

export function buildCreateSeriesTx(params: {
  name: string
  description: string
  category: string
  tags: string[]
  previewImages: string[]
}): Transaction {
  validateCreateSeriesParams(params)
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::series::create_series_entry`,
    arguments: [
      tx.pure.string(params.name),
      tx.pure.string(params.description),
      tx.pure.string(params.category),
      tx.pure.vector('string', params.tags),
      tx.pure.vector('string', params.previewImages),
    ],
  })
  return tx
}

export function buildPublishReleaseTx(params: {
  authorCapId: string
  seriesId: string
  version: string
  encryptedBlobId: string
  publicMetadataId: string
  contentHash: Uint8Array
}): Transaction {
  if (params.contentHash.length !== 32) {
    throw new Error('contentHash must be 32 bytes')
  }
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::series::publish_release`,
    arguments: [
      tx.object(params.authorCapId),
      tx.object(params.seriesId),
      tx.pure.string(params.version),
      tx.pure.string(params.encryptedBlobId),
      tx.pure.string(params.publicMetadataId),
      tx.pure.vector('u8', Array.from(params.contentHash)),
      tx.object(CLOCK),
    ],
  })
  return tx
}

// ─── Pricing ───────────────────────────────────────────────────

export function buildCreatePricingPlanTx(params: {
  authorCapId: string
  seriesId: string
  planType: 0 | 1 // 0 = onetime, 1 = subscription
  priceUsdc: bigint // atomic units (6 decimals)
  periodMs: bigint // 0 for onetime
}): Transaction {
  if (params.priceUsdc < 0n) {
    throw new Error('priceUsdc must be non-negative')
  }
  if (params.periodMs < 0n) {
    throw new Error('periodMs must be non-negative')
  }
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::purchase::create_pricing_plan`,
    arguments: [
      tx.object(params.authorCapId),
      tx.object(params.seriesId),
      tx.pure.u8(params.planType),
      tx.pure.u64(params.priceUsdc),
      tx.pure.u64(params.periodMs),
    ],
  })
  return tx
}

// ─── Purchase ──────────────────────────────────────────────────

export function buildBuyPerpetualTx(params: {
  platformConfigId: string
  planId: string
  seriesId: string
  releaseId: string
  paymentCoinIds: string[]
  amount: bigint // exact USDC atomic units to pay
}): Transaction {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  const tx = new Transaction()
  if (params.paymentCoinIds.length === 0) {
    throw new Error('paymentCoinIds is required')
  }

  const primaryCoin = tx.object(params.paymentCoinIds[0]!)
  const extraCoins = params.paymentCoinIds.slice(1).map((coinId) => tx.object(coinId))
  if (extraCoins.length > 0) {
    tx.mergeCoins(primaryCoin, extraCoins)
  }

  // Split exact payment amount from the merged coin set.
  const [paymentCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(params.amount)])
  tx.moveCall({
    target: `${packageId}::purchase::buy_perpetual`,
    arguments: [
      tx.object(params.platformConfigId),
      tx.object(params.planId),
      tx.object(params.seriesId),
      tx.object(params.releaseId),
      paymentCoin,
    ],
  })
  return tx
}

export function buildBuySubscriptionTx(params: {
  platformConfigId: string
  planId: string
  seriesId: string
  paymentCoinIds: string[]
  amount: bigint
}): Transaction {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  const tx = new Transaction()
  if (params.paymentCoinIds.length === 0) {
    throw new Error('paymentCoinIds is required')
  }

  const primaryCoin = tx.object(params.paymentCoinIds[0]!)
  const extraCoins = params.paymentCoinIds.slice(1).map((coinId) => tx.object(coinId))
  if (extraCoins.length > 0) {
    tx.mergeCoins(primaryCoin, extraCoins)
  }

  const [paymentCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(params.amount)])
  tx.moveCall({
    target: `${packageId}::purchase::buy_subscription`,
    arguments: [
      tx.object(params.platformConfigId),
      tx.object(params.planId),
      tx.object(params.seriesId),
      paymentCoin,
      tx.object(CLOCK),
    ],
  })
  return tx
}

// ─── Renew ─────────────────────────────────────────────────────

export function buildRenewSubscriptionTx(params: {
  platformConfigId: string
  planId: string
  seriesId: string
  passId: string
  paymentCoinIds: string[]
  amount: bigint
}): Transaction {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  const tx = new Transaction()
  if (params.paymentCoinIds.length === 0) {
    throw new Error('paymentCoinIds is required')
  }

  const primaryCoin = tx.object(params.paymentCoinIds[0]!)
  const extraCoins = params.paymentCoinIds.slice(1).map((coinId) => tx.object(coinId))
  if (extraCoins.length > 0) {
    tx.mergeCoins(primaryCoin, extraCoins)
  }

  const [paymentCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(params.amount)])
  tx.moveCall({
    target: `${packageId}::purchase::renew_subscription`,
    arguments: [
      tx.object(params.platformConfigId),
      tx.object(params.planId),
      tx.object(params.seriesId),
      tx.object(params.passId),
      paymentCoin,
      tx.object(CLOCK),
    ],
  })
  return tx
}

// ─── Agent Grant ───────────────────────────────────────────────

export function buildSetAgentGrantPerpetualTx(params: {
  passId: string
  agentAddress: string
}): Transaction {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::grant::set_agent_grant_perpetual`,
    arguments: [
      tx.object(params.passId),
      tx.pure.address(params.agentAddress),
    ],
  })
  return tx
}

export function buildRevokeAgentGrantPerpetualTx(params: {
  passId: string
}): Transaction {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::grant::revoke_agent_grant_perpetual`,
    arguments: [tx.object(params.passId)],
  })
  return tx
}

export function buildSetAgentGrantSubscriptionTx(params: {
  passId: string
  agentAddress: string
}): Transaction {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::grant::set_agent_grant_subscription`,
    arguments: [
      tx.object(params.passId),
      tx.pure.address(params.agentAddress),
    ],
  })
  return tx
}

export function buildRevokeAgentGrantSubscriptionTx(params: {
  passId: string
}): Transaction {
  const packageId = getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::grant::revoke_agent_grant_subscription`,
    arguments: [tx.object(params.passId)],
  })
  return tx
}
