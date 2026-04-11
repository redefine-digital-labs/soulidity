import type { Prisma } from '../../../../generated/prisma/client'
import type { SealEnvelopeSidecar } from '@web/lib/services/seal-crypto'
import type { AssetVersionObject, SkillVersionObject } from '@/lib/soulidity/types'
import {
  getRegisteredPersonalKiosk,
  getSoulCollectionObject,
  getSoulCollectionRightObject,
  getSoulGrantObject,
  getSoulMemoryObject,
  getSoulObject,
  getSoulStateObject,
  listOwnedPersonalKioskCaps,
} from '@/lib/soulidity/queries'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { upsertCollectionProjection } from '@/lib/soulidity/mirror/upsert-collection'
import { endActiveSoulGrantProjections, endSoulGrantProjection, upsertGrantProjection } from '@/lib/soulidity/mirror/upsert-grant'
import { upsertAssetVersionProjection } from '@/lib/soulidity/mirror/upsert-asset'
import { upsertContentAccessProjection, markContentAccessRevoked } from '@/lib/soulidity/mirror/upsert-content-access'
import { markSkillVersionDeleted, upsertSkillVersionProjection } from '@/lib/soulidity/mirror/upsert-skill'
import { upsertSoulProjection } from '@/lib/soulidity/mirror/upsert-soul'

export async function syncSoulProjectionFromChain(params: {
  packageId: string
  soulObjectId: string
  stateObjectId: string
  memoryObjectId: string
  category: string
  tags: string[]
  previewImages: string[]
  readme?: string | null
  sealSidecar?: SealEnvelopeSidecar | null
  creatorMemberId?: string | null
  currentOwnerMemberId?: string | null
  currentKioskCapOnChainId?: string | null
  listingObjectOnChainId?: string | null
  listedPriceAtomic?: bigint | null
  listingStatus?: 'held' | 'listed' | 'floor-violation'
}) {
  const [soul, state, memory] = await Promise.all([
    getSoulObject(params.soulObjectId, params.packageId),
    getSoulStateObject(params.stateObjectId, params.packageId),
    getSoulMemoryObject(params.memoryObjectId, params.packageId),
  ])

  // Resolve kiosk cap ID: caller-provided → registry lookup → owned-object scan (with retry)
  let kioskCapOnChainId = params.currentKioskCapOnChainId ?? null
  if (!kioskCapOnChainId) {
    const MAX_CAP_RESOLVE_ATTEMPTS = 4
    const CAP_RESOLVE_DELAY_MS = 1500

    for (let attempt = 1; attempt <= MAX_CAP_RESOLVE_ATTEMPTS; attempt++) {
      const registered = await getRegisteredPersonalKiosk({
        marketConfigId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID'),
        marketPackageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'),
        ownerAddress: state.currentOwnerAddress,
      })
      if (registered) {
        kioskCapOnChainId = registered.kioskCapOnChainId
        break
      }

      // Registry lookup missed (e.g. RPC indexing lag) — scan owned PersonalKioskCap
      // objects and match by kiosk ID to avoid storing a Kiosk object ID as a cap ID
      const ownedCaps = await listOwnedPersonalKioskCaps(state.currentOwnerAddress)
      const matched = ownedCaps.find(cap => cap.currentKioskId === state.currentKioskId)
      if (matched) {
        kioskCapOnChainId = matched.currentKioskCapOnChainId
        break
      }

      if (attempt < MAX_CAP_RESOLVE_ATTEMPTS) {
        console.warn(
          `[syncSoulProjection] PersonalKioskCap not yet indexed for kiosk ${state.currentKioskId} ` +
          `(owner ${state.currentOwnerAddress}, attempt ${attempt}/${MAX_CAP_RESOLVE_ATTEMPTS}). Retrying...`
        )
        await new Promise(resolve => setTimeout(resolve, CAP_RESOLVE_DELAY_MS))
      } else {
        throw new Error(
          `[syncSoulProjection] Could not resolve PersonalKioskCap for kiosk ${state.currentKioskId} owned by ${state.currentOwnerAddress}. ` +
          `Registry lookup and owned-object scan (${ownedCaps.length} caps found) both missed after ${MAX_CAP_RESOLVE_ATTEMPTS} attempts. ` +
          `Sync cannot proceed — retry after RPC indexing catches up.`
        )
      }
    }

    if (!kioskCapOnChainId) {
      throw new Error(
        `[syncSoulProjection] Could not resolve PersonalKioskCap for kiosk ${state.currentKioskId} owned by ${state.currentOwnerAddress} after ${MAX_CAP_RESOLVE_ATTEMPTS} attempts.`
      )
    }
  }

  return upsertSoulProjection({
    soul,
    state,
    memory,
    currentKioskCapOnChainId: kioskCapOnChainId,
    creatorMemberId: params.creatorMemberId ?? null,
    currentOwnerMemberId: params.currentOwnerMemberId ?? null,
    category: params.category,
    tags: params.tags,
    previewImages: params.previewImages,
    readme: params.readme ?? null,
    sealSidecar: (params.sealSidecar ?? null) as Prisma.InputJsonValue | null,
    listingObjectOnChainId: params.listingObjectOnChainId ?? null,
    listedPriceAtomic: params.listedPriceAtomic ?? null,
    listingStatus: params.listingStatus ?? 'held',
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

export async function syncSkillVersionProjectionFromChain(params: {
  version: SkillVersionObject
  soulOnChainId: string
  skillsOnChainId: string
  deletedAt?: Date | null
  sealSidecar?: SealEnvelopeSidecar | null
}) {
  return upsertSkillVersionProjection({
    version: params.version,
    soulOnChainId: params.soulOnChainId,
    skillsOnChainId: params.skillsOnChainId,
    deletedAt: params.deletedAt ?? null,
    sealSidecar: params.sealSidecar ?? null,
  })
}

export async function markSkillVersionDeletedFromChain(params: {
  skillsOnChainId: string
  skillName: string
  versionIndex: number
  deletedAt?: Date | null
}) {
  return markSkillVersionDeleted(params)
}

export async function syncAssetVersionProjectionFromChain(params: {
  version: AssetVersionObject
  soulOnChainId: string
  assetsOnChainId: string
  deletedAt?: Date | null
  sealSidecar?: SealEnvelopeSidecar | null
}) {
  return upsertAssetVersionProjection({
    version: params.version,
    soulOnChainId: params.soulOnChainId,
    assetsOnChainId: params.assetsOnChainId,
    deletedAt: params.deletedAt ?? null,
    sealSidecar: params.sealSidecar ?? null,
  })
}

export async function syncContentAccessProjectionFromChain(params: {
  soulOnChainId: string
  accessListOnChainId: string
  granteeAddress: string
  scopeMask: number
  pricePaidAtomic: number | bigint
  grantedAtMs: number | bigint
  expiresAtMs?: number | bigint | null
}) {
  return upsertContentAccessProjection(params)
}

export async function markContentAccessRevokedFromChain(params: {
  accessListOnChainId: string
  granteeAddress: string
}) {
  return markContentAccessRevoked(params)
}
