import { Transaction, type TransactionArgument } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'
import { getConfiguredSoulidityNetwork } from '../deployment'

export const MAX_NAME_BYTES = 256
export const MAX_DESCRIPTION_BYTES = 4096
export const MAX_IMAGE_URL_BYTES = 1024
export const MAX_CREATOR_ROYALTY_BPS = 2_500

// Mirrors web/lib/soulidity/kiosk.ts. The desktop renderer cannot import the
// web copy directly (no path alias), so the canonical addresses are duplicated
// here. The two lists must stay in sync.
const OFFICIAL_MAINNET_KIOSK_PACKAGE_ID =
  '0xdfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3'
const OFFICIAL_TESTNET_KIOSK_PACKAGE_ID =
  '0xc9f6a531d5f4e11ef38dd782c9ab5403fb3c011595384c429285952ff6b31839'

export function resolveKioskPackageId(): string {
  const configured = process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID?.trim()
  if (configured) return configured

  const network = getConfiguredSoulidityNetwork()
  if (network === 'mainnet') return OFFICIAL_MAINNET_KIOSK_PACKAGE_ID
  if (network === 'testnet') return OFFICIAL_TESTNET_KIOSK_PACKAGE_ID

  throw new Error(
    `NEXT_PUBLIC_KIOSK_PACKAGE_ID must be set (no fallback for network=${network})`,
  )
}

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

export function buildBuyerKioskArgs(tx: Transaction, params: {
  buyerKioskId?: string | null
  buyerKioskCapOnChainId?: string | null
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const kioskPackageId = resolveKioskPackageId()
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
    target: `${packageId}::market::register_existing_personal_kiosk`,
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
