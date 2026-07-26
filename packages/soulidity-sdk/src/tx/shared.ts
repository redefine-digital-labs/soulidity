import { Transaction, type TransactionArgument } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'
import { getKioskPackageAddress } from '../kiosk'
import {
  CANONICAL_MEMORY_NAME,
  CANONICAL_SOUL_DOC_NAME,
  KIND_MEMORY,
  KIND_SOUL_DOC,
  NO_DOWNLOAD_POLICY,
  READ_GRANT,
  READ_OWNER,
  assertSlotReadModeAllowed,
  getBuiltinKindDescriptor,
} from '../kinds'
import type { SoulDownloadPolicy } from '../types'

export const MAX_NAME_BYTES = 256
export const MAX_DESCRIPTION_BYTES = 4096
export const MAX_IMAGE_URL_BYTES = 1024
export const MAX_CREATOR_ROYALTY_BPS = 2_500
export const MAX_COLLECTION_ROYALTY_BPS = 2_500
export const MAX_STATE_CONFIG_VALUE_BYTES = 64 * 1024
// Web/SDK soft cap on a collection's max_supply. The on-chain contract only
// rejects `Some(0)` (ESupplyCapInvalid); any positive u64 is accepted on chain.
// This 1M ceiling is a UX guardrail, not a security boundary.
export const MAX_COLLECTION_SUPPLY = 1_000_000

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

export function validateCollectionArgs(params: {
  name: string
  description: string
  imageUrl: string
  extraRoyaltyBps: number
  tradeable: boolean
  maxSupply?: number | null
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

  if (typeof params.tradeable !== 'boolean') {
    throw new Error('tradeable must be a boolean')
  }

  if (params.maxSupply != null) {
    if (
      !Number.isSafeInteger(params.maxSupply)
      || params.maxSupply < 1
      || params.maxSupply > MAX_COLLECTION_SUPPLY
    ) {
      throw new Error(`maxSupply must be an integer between 1 and ${MAX_COLLECTION_SUPPLY}, or null for unlimited`)
    }
  }
}

// ── Phase 2: initial content / state-config validation ──────────────────

export interface InitialContentEntryInput {
  /** Numeric kind id from KindRegistry. */
  kind: number
  /** Slot name. For SOUL_DOC must be "soul"; for MEMORY must be "default". */
  name: string
  /** Slot read-mode mask (READ_OWNER | READ_GRANT | READ_PAID | READ_PUBLIC subset). */
  slotReadModeMask: number
  /** Slot download policy. */
  downloadPolicy: SoulDownloadPolicy
  /** Whether to bind this entry as the active version for its kind (only valid for has_active_binding kinds). */
  setActive: boolean
  /** Walrus blob object id (consumed by the move call). */
  blobObjectId: string
}

export interface StateConfigEntryInput {
  key: string
  /** UTF-8 string body; encoded to vector<u8> at PTB build time. */
  valueUtf8: string
}

const MINT_INVARIANT_READ_MODE = READ_OWNER | READ_GRANT

function assertBuiltinDownloadPolicyAllowed(entry: InitialContentEntryInput): void {
  const descriptor = getBuiltinKindDescriptor(entry.kind)
  if (!descriptor || descriptor.requiresDownloadPolicy) return
  if (entry.downloadPolicy !== NO_DOWNLOAD_POLICY) {
    throw new Error(
      `kind ${entry.kind} (${descriptor.name}) does not accept download_policy; use the protocol no-policy value (${NO_DOWNLOAD_POLICY}/0)`,
    )
  }
}

/**
 * Mirrors `market.move::assert_initial_content_well_formed`. Run client-side
 * before composing the PTB so the user sees a friendly error instead of the
 * raw Move abort.
 *
 * Exactly one `(KIND_SOUL_DOC, "soul")` entry is required. At least one
 * `(KIND_MEMORY, "default")` entry is required. Custom kinds must have
 * `OP_APPEND` in their descriptor (this client-side check uses the built-in
 * descriptors only — admin-registered kinds bypass it and rely on the on-
 * chain abort).
 */
export function validateInitialContentEntries(
  entries: ReadonlyArray<InitialContentEntryInput>,
): void {
  let soulDocCount = 0
  let memoryCount = 0
  for (const entry of entries) {
    if (entry.blobObjectId.trim().length === 0) {
      throw new Error('initial content entry blobObjectId is required')
    }
    if (entry.name.trim().length === 0) {
      throw new Error('initial content entry name is required')
    }
    assertBuiltinDownloadPolicyAllowed(entry)
    if (entry.kind === KIND_SOUL_DOC) {
      if (entry.name !== CANONICAL_SOUL_DOC_NAME) {
        throw new Error(`SOUL_DOC entry name must be "${CANONICAL_SOUL_DOC_NAME}"`)
      }
      if (entry.slotReadModeMask !== MINT_INVARIANT_READ_MODE) {
        throw new Error('SOUL_DOC slot_read_mode_mask must be READ_OWNER | READ_GRANT')
      }
      if (entry.setActive) {
        throw new Error('SOUL_DOC entry cannot set_active (kind has no active binding)')
      }
      soulDocCount += 1
      continue
    }
    if (entry.kind === KIND_MEMORY) {
      if (entry.name !== CANONICAL_MEMORY_NAME) {
        throw new Error(`MEMORY entry name must be "${CANONICAL_MEMORY_NAME}"`)
      }
      if (entry.slotReadModeMask !== MINT_INVARIANT_READ_MODE) {
        throw new Error('MEMORY slot_read_mode_mask must be READ_OWNER | READ_GRANT')
      }
      if (entry.setActive) {
        throw new Error('MEMORY entry cannot set_active (kind has no active binding)')
      }
      memoryCount += 1
      continue
    }
    // Built-in non-invariant kinds have descriptors we can validate against;
    // unknown / custom kinds skip the read-mode subset check (the chain
    // enforces it).
    const descriptor = getBuiltinKindDescriptor(entry.kind)
    if (descriptor) {
      if ((descriptor.opMask & 1 /* OP_APPEND */) === 0) {
        throw new Error(`kind ${entry.kind} (${descriptor.name}) does not allow append at mint time`)
      }
      assertSlotReadModeAllowed({
        readModeMask: entry.slotReadModeMask,
        kindReadModeMask: descriptor.readModeMask,
        downloadPolicy: entry.downloadPolicy,
      })
      if (entry.setActive && !descriptor.hasActiveBinding) {
        throw new Error(`kind ${entry.kind} (${descriptor.name}) does not support set_active`)
      }
    }
  }
  if (soulDocCount !== 1) {
    throw new Error(`mint requires exactly 1 SOUL_DOC entry; got ${soulDocCount}`)
  }
  if (memoryCount < 1) {
    throw new Error('mint requires at least 1 MEMORY entry; got 0')
  }
}

export function validateInitialStateConfigEntries(
  entries: ReadonlyArray<StateConfigEntryInput>,
): void {
  const seenKeys = new Set<string>()
  for (const entry of entries) {
    if (entry.key.trim().length === 0) {
      throw new Error('state config entry key is required')
    }
    if (seenKeys.has(entry.key)) {
      throw new Error(`duplicate state config key "${entry.key}"`)
    }
    seenKeys.add(entry.key)
    if (getUtf8ByteLength(entry.valueUtf8) > MAX_STATE_CONFIG_VALUE_BYTES) {
      throw new Error(`state config value for "${entry.key}" exceeds ${MAX_STATE_CONFIG_VALUE_BYTES} bytes`)
    }
  }
}

// ── Buyer kiosk plumbing (unchanged from phase 1) ───────────────────────

export function buildBuyerKioskArgs(tx: Transaction, params: {
  buyerKioskId?: string | null
  buyerKioskCapOnChainId?: string | null
}) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const kioskPackageId = getKioskPackageAddress()
  const buyerKioskId = params.buyerKioskId?.trim()
  const buyerKioskCapOnChainId = params.buyerKioskCapOnChainId?.trim()

  if ((buyerKioskId && !buyerKioskCapOnChainId) || (!buyerKioskId && buyerKioskCapOnChainId)) {
    throw new Error('buyerKioskId and buyerKioskCapOnChainId must be provided together')
  }

  if (buyerKioskId && buyerKioskCapOnChainId) {
    tx.moveCall({
      target: `${packageId}::market::ensure_personal_kiosk_registered_v2`,
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
    target: `${packageId}::market::ensure_personal_kiosk_registered_v2`,
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
