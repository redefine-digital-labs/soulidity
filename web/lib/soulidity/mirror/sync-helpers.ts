/**
 * Phase 2 mirror sync helpers. Replaces the legacy four-channel
 * (memory/skills/assets/metadata) sync with unified content-version syncs.
 * Every post-tx route should:
 *   1. Read on-chain Soul + SoulState (and SoulContent / SoulPaidAccessList
 *      if needed) via this layer.
 *   2. Pass extracted event data to the appropriate `upsert*` writer.
 */
import type { Prisma } from '@db/prisma-client'
import type { prisma } from '@/lib/prisma'
import type { SealEnvelopeSidecar } from '@soulidity/sdk'

// Optional Prisma transaction client for content-version helpers — sync
// routes pass `tx` so the projection write atomically commits with the
// SoulTxSync idempotency write.
type ContentSyncDbClient = Prisma.TransactionClient | typeof prisma
import {
  endActiveSoulGrantProjections,
  endSoulGrantProjection,
  upsertGrantProjection,
} from '@/lib/soulidity/mirror/upsert-grant'
import { upsertCollectionProjection } from '@/lib/soulidity/mirror/upsert-collection'
import { upsertContentVersionProjection } from '@/lib/soulidity/mirror/upsert-content-version'
import {
  markPaidAccessEntryRevoked,
  markPaidAccessKindConfigDeleted,
  upsertPaidAccessEntry,
  upsertPaidAccessKindConfig,
} from '@/lib/soulidity/mirror/upsert-paid-access'
import { upsertSoulProjection } from '@/lib/soulidity/mirror/upsert-soul'
import {
  getRegisteredPersonalKiosk,
  getSoulCollectionObject,
  getSoulCollectionRightObject,
  getSoulContentObject,
  getSoulGrantObject,
  getSoulObject,
  getSoulPaidAccessListObject,
  getSoulStateObject,
  listOwnedPersonalKioskCaps,
} from '@soulidity/sdk'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import type { SoulDownloadPolicy } from '@soulidity/sdk'
import { NativeReceiveError } from '@/lib/animacraft/native-receive'

interface ActiveBindingMirror {
  name: string
  versionIndex: number
  downloadPolicy: string
}

interface StateConfigSnapshot {
  spriteConfigJson?: string | null
  voiceConfigJson?: string | null
}

/**
 * Refresh the SoulAsset projection from on-chain Soul + SoulState (and
 * optionally SoulContent for active binding lookups). Phase 2 no longer
 * reads SoulMetadata / SoulMemory / SoulSkills / SoulAssets — those
 * objects don't exist.
 */
export async function syncSoulProjectionFromChain(params: {
  packageId: string
  soulObjectId: string
  stateObjectId: string
  tags: string[]
  previewImages: string[]
  readme?: string | null
  creatorMemberId?: string | null
  currentOwnerMemberId?: string | null
  currentKioskCapOnChainId?: string | null
  listingObjectOnChainId?: string | null
  listedPriceAtomic?: bigint | null
  listingStatus?: 'held' | 'listed' | 'floor-violation'
  /** Optional active sprite/voice cache. Caller may load it from the DB
   *  mirror or from the typed-content root (admin-tools). */
  activeSprite?: ActiveBindingMirror | null
  activeVoice?: ActiveBindingMirror | null
  /** Cached snapshots of `SoulState.config_ext` keys we mirror by name. */
  stateConfig?: StateConfigSnapshot
  /** Native purchase/cancellation: never overwrite subsequent custody or relisting. */
  expectedNativeHeldState?: {
    ownerAddress: string
    kioskId: string
    ownershipEpoch: string
    verifyReadSet: () => Promise<void>
  }
  /** Receipt-bound native listing; a later reprice/sale must not be overwritten. */
  expectedNativeListedState?: {
    ownerAddress: string
    kioskId: string
    ownershipEpoch: string
    listingId: string
    priceAtomic: bigint
    verifyReadSet: () => Promise<void>
  }
}) {
  if (params.expectedNativeHeldState && params.expectedNativeListedState) {
    throw new Error('Conflicting native mirror state guards')
  }
  const expectedNative = params.expectedNativeHeldState ?? params.expectedNativeListedState
  const [soul, state] = await Promise.all([
    getSoulObject(params.soulObjectId, params.packageId),
    getSoulStateObject(params.stateObjectId, params.packageId),
  ])

  // Resolve content root projection if state already exposes a content_id.
  // Failure is non-fatal — the on-chain object exists by construction
  // (mint binds it before sharing state); transient indexing lag is OK.
  let content: { objectId: string } | null = null
  if (state.contentId) {
    try {
      content = await getSoulContentObject(state.contentId, params.packageId)
    } catch (error) {
      console.warn(
        `[syncSoulProjection] SoulContent ${state.contentId} not yet readable`,
        error,
      )
    }
  }

  const assertNativeHeldState = () => {
    const expected = params.expectedNativeHeldState
    if (!expected) return
    if (soul.objectId !== params.soulObjectId || state.objectId !== params.stateObjectId
      || state.soulId !== soul.objectId || soul.provenanceKind !== 'animacraft'
      || state.currentOwnerAddress !== expected.ownerAddress || state.isListed
      || state.currentKioskId !== expected.kioskId || String(state.ownershipEpoch) !== expected.ownershipEpoch
      || params.listingObjectOnChainId != null || params.listedPriceAtomic != null
      || (params.listingStatus != null && params.listingStatus !== 'held')) {
      throw new Error('Native Soul ownership changed before held-state mirror write')
    }
  }
  assertNativeHeldState()

  const assertNativeListedState = () => {
    const expected = params.expectedNativeListedState
    if (!expected) return
    if (soul.objectId !== params.soulObjectId || state.objectId !== params.stateObjectId
      || state.soulId !== soul.objectId || soul.provenanceKind !== 'animacraft'
      || state.currentOwnerAddress !== expected.ownerAddress || !state.isListed
      || state.currentKioskId !== expected.kioskId || String(state.ownershipEpoch) !== expected.ownershipEpoch
      || params.listingObjectOnChainId !== expected.listingId || params.listedPriceAtomic !== expected.priceAtomic
      || params.listingStatus !== 'listed') {
      throw new NativeReceiveError('NATIVE_LISTING_STATE_CHANGED', 'Native listing changed before mirror write', 409)
    }
  }
  assertNativeListedState()

  // Native recovery resolves the owner's actual cap without a fee config or
  // purchase gate. Cached/caller-provided caps cannot stand in for current custody.
  // Ordinary callers retain their existing registry/scan resolution.
  let kioskCapOnChainId = expectedNative ? null : params.currentKioskCapOnChainId ?? null
  if (!kioskCapOnChainId) {
    const MAX_CAP_RESOLVE_ATTEMPTS = 4
    const CAP_RESOLVE_DELAY_MS = 1500

    for (let attempt = 1; attempt <= MAX_CAP_RESOLVE_ATTEMPTS; attempt++) {
      const registered = expectedNative ? null : await getRegisteredPersonalKiosk({
        marketConfigId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'),
        marketPackageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID'),
        ownerAddress: state.currentOwnerAddress,
        kioskRegistryId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID'),
      })
      if (registered) {
        kioskCapOnChainId = registered.kioskCapOnChainId
        break
      }

      const ownedCaps = await listOwnedPersonalKioskCaps(state.currentOwnerAddress)
      const matched = ownedCaps.find(cap => cap.currentKioskId === state.currentKioskId
        && (!expectedNative || cap.ownerAddress === state.currentOwnerAddress))
      if (matched) {
        kioskCapOnChainId = matched.currentKioskCapOnChainId
        break
      }

      if (attempt < MAX_CAP_RESOLVE_ATTEMPTS) {
        console.warn(
          `[syncSoulProjection] PersonalKioskCap not yet indexed for kiosk ${state.currentKioskId} ` +
          `(owner ${state.currentOwnerAddress}, attempt ${attempt}/${MAX_CAP_RESOLVE_ATTEMPTS}). Retrying...`,
        )
        await new Promise(resolve => setTimeout(resolve, CAP_RESOLVE_DELAY_MS))
      } else {
        throw new Error(
          `[syncSoulProjection] Could not resolve PersonalKioskCap for kiosk ${state.currentKioskId} owned by ${state.currentOwnerAddress}. ` +
          `Registry lookup and owned-object scan (${ownedCaps.length} caps found) both missed after ${MAX_CAP_RESOLVE_ATTEMPTS} attempts. ` +
          `Sync cannot proceed — retry after RPC indexing catches up.`,
        )
      }
    }

    if (!kioskCapOnChainId) {
      throw new Error(
        `[syncSoulProjection] Could not resolve PersonalKioskCap for kiosk ${state.currentKioskId} owned by ${state.currentOwnerAddress} after ${MAX_CAP_RESOLVE_ATTEMPTS} attempts.`,
      )
    }
  }

  if (expectedNative) {
    assertNativeHeldState()
    assertNativeListedState()
    await expectedNative.verifyReadSet()
  }

  return upsertSoulProjection({
    soul,
    state,
    content,
    currentKioskCapOnChainId: kioskCapOnChainId,
    creatorMemberId: params.creatorMemberId ?? null,
    currentOwnerMemberId: params.currentOwnerMemberId ?? null,
    tags: params.tags,
    previewImages: params.previewImages,
    readme: params.readme ?? null,
    listingObjectOnChainId: params.listingObjectOnChainId ?? null,
    listedPriceAtomic: params.listedPriceAtomic ?? null,
    listingStatus: params.listingStatus ?? 'held',
    activeSprite: params.activeSprite ?? null,
    activeVoice: params.activeVoice ?? null,
    stateConfig: params.stateConfig,
  })
}

export async function syncCollectionProjectionFromChain(params: {
  packageId: string
  collectionObjectId: string
  creatorMemberId?: string | null
  currentHolderMemberId?: string | null
  listingObjectOnChainId?: string | null
  listedPriceAtomic?: bigint | null
  listingStatus?: 'held' | 'listed'
  floorPriceAtomic?: bigint | null
}) {
  const collection = await getSoulCollectionObject(params.collectionObjectId, params.packageId)
  const right = await getSoulCollectionRightObject(collection.rightId, params.packageId)

  return upsertCollectionProjection({
    collection,
    right,
    currentSupply: collection.currentSupply,
    maxSoulSupply: collection.maxSupply,
    creatorMemberId: params.creatorMemberId ?? null,
    currentHolderMemberId: params.currentHolderMemberId ?? null,
    listingObjectOnChainId: params.listingObjectOnChainId ?? null,
    listedPriceAtomic: params.listedPriceAtomic ?? null,
    listingStatus: params.listingStatus ?? 'held',
    floorPriceAtomic: params.floorPriceAtomic ?? null,
  })
}

export async function syncGrantProjectionFromChain(params: {
  packageId: string
  grantObjectId: string
  soulOnChainId: string
  issuedByMemberId?: string | null
  granteeMemberId?: string | null
  status?: 'active' | 'revoked' | 'expired' | 'superseded' | 'invalidated'
  endedAt?: Date | null
  replacedByGrantOnChainId?: string | null
}) {
  const grant = await getSoulGrantObject(params.grantObjectId, params.packageId)
  return upsertGrantProjection({
    grant,
    soulOnChainId: params.soulOnChainId,
    issuedByMemberId: params.issuedByMemberId ?? null,
    granteeMemberId: params.granteeMemberId ?? null,
    status: params.status ?? 'active',
    endedAt: params.endedAt ?? null,
    replacedByGrantOnChainId: params.replacedByGrantOnChainId ?? null,
  })
}

export async function endSoulGrantProjectionFromChain(params: {
  grantOnChainId: string
  status: 'revoked' | 'expired' | 'superseded' | 'invalidated'
  endedAt?: Date | null
  replacedByGrantOnChainId?: string | null
}) {
  return endSoulGrantProjection(params)
}

export async function endActiveSoulGrantProjectionsFromChain(params: {
  soulOnChainId: string
  status: 'revoked' | 'expired' | 'superseded' | 'invalidated'
  endedAt?: Date | null
}) {
  return endActiveSoulGrantProjections(params)
}

// ── Content version sync (replaces memory/skill/asset triple) ───────────

export async function syncContentVersionProjectionFromChain(
  params: {
    soulOnChainId: string
    contentOnChainId: string
    kind: number
    kindName: string
    name: string
    versionIndex: number
    blobObjectId: string
    blobId?: string | null
    readModeMask: number
    opMask: number
    grantScopeMask: number
    isPublic: boolean
    sealEncrypted: boolean
    downloadPolicy: SoulDownloadPolicy
    sealSidecar?: SealEnvelopeSidecar | null
    createdAtMs: number | bigint
  },
  client?: ContentSyncDbClient,
) {
  return upsertContentVersionProjection(params, client)
}

// ── Paid access sync ────────────────────────────────────────────────────

export async function syncPaidAccessKindConfigFromChain(params: {
  soulOnChainId: string
  paidAccessListOnChainId: string
  kind: number
  version: number
  priceAtomic: bigint | number
  scopeMask: number
  durationMs?: number | bigint | null
  ownershipEpochSnapshot: number
}) {
  return upsertPaidAccessKindConfig(params)
}

export async function markPaidAccessKindConfigDeletedFromChain(params: {
  paidAccessListOnChainId: string
  kind: number
}) {
  return markPaidAccessKindConfigDeleted(params)
}

export async function syncPaidAccessEntryFromChain(params: {
  soulOnChainId: string
  paidAccessListOnChainId: string
  buyerAddress: string
  kind: number
  version: number
  scopeMask: number
  pricePaidAtomic: bigint | number
  expiresAtMs?: number | bigint | null
  ownershipEpochSnapshot: number
  createdAtMs: number | bigint
}) {
  return upsertPaidAccessEntry(params)
}

export async function markPaidAccessEntryRevokedFromChain(params: {
  paidAccessListOnChainId: string
  buyerAddress: string
  kind: number
}) {
  return markPaidAccessEntryRevoked(params)
}

/**
 * Read on-chain `SoulPaidAccessList` and verify the soul linkage. Useful
 * for sanity-checking before issuing post-tx writes against a freshly
 * minted list.
 */
export async function ensurePaidAccessListReadable(params: {
  packageId: string
  paidAccessListObjectId: string
}) {
  return getSoulPaidAccessListObject(params.paidAccessListObjectId, params.packageId)
}
