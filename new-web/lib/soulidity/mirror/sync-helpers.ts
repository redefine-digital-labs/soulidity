import type { Prisma } from '../../../../generated/prisma/client'
import type { SealEnvelopeSidecar } from '@web/lib/services/seal-crypto'
import {
  getRegisteredPersonalKiosk,
  getSkillVersionObject,
  getSoulCollectionObject,
  getSoulCollectionRightObject,
  getSoulGrantObject,
  getSoulMemoryObject,
  getSoulObject,
  getSoulSkillsObject,
  getSoulStateObject,
} from '@/lib/soulidity/queries'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { upsertCollectionProjection } from '@/lib/soulidity/mirror/upsert-collection'
import { endActiveSoulGrantProjections, endSoulGrantProjection, upsertGrantProjection } from '@/lib/soulidity/mirror/upsert-grant'
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
  listingStatus?: 'held' | 'listed'
  latestSkillVersionSealSidecar?: SealEnvelopeSidecar | null
}) {
  const [soul, state, memory] = await Promise.all([
    getSoulObject(params.soulObjectId, params.packageId),
    getSoulStateObject(params.stateObjectId, params.packageId),
    getSoulMemoryObject(params.memoryObjectId, params.packageId),
  ])
  const skills = state.skillsId ? await getSoulSkillsObject(state.skillsId, params.packageId) : null
  if (skills?.latestVersionId) {
    const latestVersion = await getSkillVersionObject(skills.latestVersionId, params.packageId)
    await upsertSkillVersionProjection({
      version: latestVersion,
      soulOnChainId: params.soulObjectId,
      skillsOnChainId: skills.objectId,
      sealSidecar: params.latestSkillVersionSealSidecar ?? null,
    })
  }

  // Resolve kiosk cap ID: use caller-provided value, fall back to registry lookup
  let kioskCapOnChainId = params.currentKioskCapOnChainId ?? null
  if (!kioskCapOnChainId) {
    const registered = await getRegisteredPersonalKiosk({
      marketConfigId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID'),
      marketPackageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'),
      ownerAddress: state.currentOwnerAddress,
    })
    kioskCapOnChainId = registered?.kioskCapOnChainId ?? state.currentKioskId
  }

  return upsertSoulProjection({
    soul,
    state,
    memory,
    currentKioskCapOnChainId: kioskCapOnChainId,
    latestSkillVersionOnChainId: skills?.latestVersionId ?? null,
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
  packageId: string
  versionObjectId: string
  soulOnChainId: string
  skillsOnChainId: string
  deletedAt?: Date | null
  sealSidecar?: SealEnvelopeSidecar | null
}) {
  const version = await getSkillVersionObject(params.versionObjectId, params.packageId)
  return upsertSkillVersionProjection({
    version,
    soulOnChainId: params.soulOnChainId,
    skillsOnChainId: params.skillsOnChainId,
    deletedAt: params.deletedAt ?? null,
    sealSidecar: params.sealSidecar ?? null,
  })
}

export async function markSkillVersionDeletedFromChain(params: {
  versionOnChainId: string
  deletedAt?: Date | null
}) {
  return markSkillVersionDeleted(params)
}
