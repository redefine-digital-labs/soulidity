import type { SealEnvelopeSidecar } from '@web/lib/services/seal-crypto'

export type SoulListingStatus = 'held' | 'listed' | 'floor-violation'
export type SoulGrantStatus = 'active' | 'revoked' | 'expired' | 'superseded' | 'invalidated'
export type SoulGrantScope = 'seal' | 'memory' | 'skills'
export type SoulAccessKind = 'owner' | 'granted-agent'
export type SkillAccessKind = 'owner' | 'granted-agent'
export type SoulWriterKind = 'founder' | 'owner' | 'granted-agent'
export type SoulProvenanceKind = 'native' | 'imported' | 'personal-join'
export type SoulSkillVisibility = 'public' | 'private'

export interface SoulidityMarketConfig {
  objectId: string
  packageId: string
  feeRecipient: string
  platformFeeBps: number
  paused: boolean
}

export interface SoulObject {
  objectId: string
  packageId: string
  creatorAddress: string
  name: string
  description: string
  imageUrl: string
  metadataRef: string | null
  protectedBlobId: string | null
  protectedBlobObjectId: string
  provenanceKind: SoulProvenanceKind
  originRef: string | null
}

export interface ActiveGrantSlotObject {
  grantId: string
  granteeAddress: string
  scopeMask: number
  scopes: SoulGrantScope[]
  expiresAtMs: number | null
}

export interface SoulStateObject {
  objectId: string
  packageId: string
  soulId: string
  creatorAddress: string
  creatorRoyaltyBps: number
  currentOwnerAddress: string
  currentKioskId: string
  ownershipEpoch: number
  grantCapacity: number
  activeGrantCount: number
  activeGrants: ActiveGrantSlotObject[]
  skillsId: string | null
  collectionId: string | null
}

export interface SoulListingObject {
  objectId: string
  packageId: string
  soulId: string
  stateId: string
  sellerAddress: string
  sellerKioskId: string
  priceAtomic: bigint
  creatorAddress: string
  creatorRoyaltyBps: number
  collectionId: string | null
  active: boolean
}

export interface SoulCollectionObject {
  objectId: string
  packageId: string
  creatorAddress: string
  extraRoyaltyBps: number
  tradeable: boolean
  currentHolderAddress: string
  currentHolderKioskId: string
  rightId: string
}

export interface SoulCollectionRightObject {
  objectId: string
  packageId: string
  collectionId: string
  creatorAddress: string
  name: string
  description: string
  imageUrl: string
  extraRoyaltyBps: number
  tradeable: boolean
}

export interface CollectionListingObject {
  objectId: string
  packageId: string
  collectionId: string
  rightId: string
  sellerAddress: string
  sellerKioskId: string
  priceAtomic: bigint
  active: boolean
}

export interface SoulGrantObject {
  objectId: string
  packageId: string
  soulId: string
  granteeAddress: string
  issuedByAddress: string
  ownershipEpochSnapshot: number
  scopeMask: number
  scopes: SoulGrantScope[]
  expiresAtMs: number | null
}

export interface SoulMemoryObject {
  objectId: string
  packageId: string
  soulId: string
  nextIndex: number
  entryCount: number
  lastEntryId: string | null
  lastEntryCreatedAtMs: number | null
}

export interface MemoryEntryObject {
  objectId: string
  packageId: string
  soulId: string
  index: number
  writerAddress: string
  writerKind: SoulWriterKind
  createdAtMs: number
  blobObjectId: string
  blobId: string | null
  previousEntryId: string | null
}

export interface SoulSkillsObject {
  objectId: string
  packageId: string
  soulId: string
  nextVersion: number
  versionCount: number
  latestVersionId: string | null
}

export interface SkillVersionObject {
  objectId: string
  packageId: string
  soulId: string
  skillsId: string
  versionNumber: number
  previousVersionId: string | null
  visibility: SoulSkillVisibility
  deleted: boolean
  createdAtMs: number
  blobObjectId: string
  blobId: string | null
}

export interface SoulQuoteBreakdown {
  platformFeeAtomic: string
  priceAtomic: string
  creatorRoyaltyAtomic: string
  collectionRoyaltyAtomic: string
  totalAtomic: string
}

export interface SoulAssetSummary {
  id: string
  onChainId: string
  stateOnChainId: string
  memoryOnChainId: string
  name: string
  description: string
  imageUrl: string
  metadataRef: string | null
  contentBlobId: string | null
  contentBlobObjectId: string
  provenanceKind: SoulProvenanceKind
  originRef: string | null
  category: string
  tags: string[]
  previewImages: string[]
  creatorAddress: string
  creatorRoyaltyBps: number
  currentOwnerAddress: string
  currentKioskId: string
  currentKioskCapOnChainId: string
  listingObjectOnChainId: string | null
  listedPriceAtomic: string | null
  listingStatus: SoulListingStatus
  collectionOnChainId: string | null
  grantCapacity: number
  activeGrantCount: number
  skillsOnChainId: string | null
  latestSkillVersionOnChainId: string | null
  createdAt: string
  updatedAt: string
}

export interface SoulGrantRecord {
  id: string
  onChainId: string
  soulOnChainId: string
  issuedByAddress: string
  issuedByMemberId: string | null
  granteeAddress: string
  granteeMemberId: string | null
  scopes: SoulGrantScope[]
  status: SoulGrantStatus
  expiresAt: string | null
  endedAt: string | null
  replacedByGrantOnChainId: string | null
  createdAt: string
  updatedAt: string
}

export interface SoulMemoryEntryRecord {
  id: string
  onChainId: string
  soulOnChainId: string
  memoryOnChainId: string
  entryIndex: number
  writerAddress: string
  writerKind: SoulWriterKind
  blobObjectId: string
  blobId: string | null
  createdAtMs: number
  createdAt: string
  updatedAt: string
}

export interface SoulSkillVersionRecord {
  id: string
  soulOnChainId: string
  skillsOnChainId: string
  versionOnChainId: string
  versionNumber: number
  visibility: SoulSkillVisibility
  deletedAt: string | null
  blobObjectId: string
  blobId: string | null
  previousVersionOnChainId: string | null
  sealSidecar: SealEnvelopeSidecar | null
  createdAtMs: number
  createdAt: string
  updatedAt: string
}

export interface SoulCollectionAssetSummary {
  id: string
  onChainId: string
  rightOnChainId: string
  creatorAddress: string
  creatorMemberId: string | null
  currentHolderAddress: string
  currentHolderMemberId: string | null
  currentHolderKioskId: string
  name: string
  description: string
  imageUrl: string
  extraRoyaltyBps: number
  floorPriceAtomic: string | null
  tradeable: boolean
  listingObjectOnChainId: string | null
  listedPriceAtomic: string | null
  listingStatus: SoulListingStatus
  soulCount: number
  createdAt: string
  updatedAt: string
}

export interface SoulCollectionAssetDetail extends SoulCollectionAssetSummary {
  souls: SoulAssetSummary[]
}

export interface CollectionDetailStats {
  soulFloorAtomic: string | null
  soulHolders: number
  soulVolume: string | null
}

export interface CollectionDetailResponse extends SoulCollectionAssetDetail {
  quote: {
    priceAtomic: string
    platformFeeAtomic: string
    totalAtomic: string
  } | null
  isHolder: boolean
  isCreator: boolean
  stats: CollectionDetailStats
}

export interface SoulAssetDetail extends SoulAssetSummary {
  creatorMemberId: string | null
  currentOwnerMemberId: string | null
  readme: string | null
  sealSidecar: SealEnvelopeSidecar | null
  collection: SoulCollectionAssetSummary | null
  activeGrants: SoulGrantRecord[]
  memoryEntries: SoulMemoryEntryRecord[]
  skillVersions: SoulSkillVersionRecord[]
  isOwner: boolean
  isCreator: boolean
  isGrantedAgent: boolean
  quote: SoulQuoteBreakdown | null
  platformFeeBps: number | null
}

export interface SoulsListResponse {
  items: SoulAssetSummary[]
  total: number
  page: number
  totalPages: number
}

export interface CollectionsListResponse {
  items: SoulCollectionAssetSummary[]
  total: number
  page: number
  totalPages: number
}

export interface MySoulActiveGrant {
  granteeAddress: string
  createdAt: string
}

export interface MySoulEntry extends SoulAssetSummary {
  collectionName: string | null
  activeGrantDetails: MySoulActiveGrant[]
}

export interface MySoulsResponse {
  owned: MySoulEntry[]
  collections: SoulCollectionAssetSummary[]
  grants: SoulGrantRecord[]
}

export interface SoulAccessResponse {
  artifact: {
    walrusBlobUrl: string
    walrusBlobId: string
    contentBlobObjectId: string
  }
  accessPolicy: {
    packageId: string
    soulObjectId: string
    stateObjectId: string
    moduleName: 'seal_policy'
    functionName: 'seal_approve_owner' | 'seal_approve_granted_agent'
    soulGrantObjectId: string | null
  }
  seal: {
    network: 'testnet' | 'mainnet'
    threshold: number
    verifyKeyServers: boolean
    serverConfigs: Array<{
      objectId: string
      weight: number
      aggregatorUrl?: string
    }>
  }
  sealSidecar: SealEnvelopeSidecar
  viewerAddress: string
  accessKind: SoulAccessKind
  sessionTtlMin: number
}

export type SkillAccessResponse =
  | {
      visibility: 'public'
      artifact: {
        walrusBlobUrl: string | null
        walrusBlobId: string | null
        blobObjectId: string
      }
    }
  | {
      visibility: 'private'
      artifact: {
        walrusBlobUrl: string | null
        walrusBlobId: string | null
        blobObjectId: string
      }
      accessPolicy: {
        packageId: string
        stateObjectId: string
        skillsObjectId: string
        versionObjectId: string
        moduleName: 'skills'
        functionName: 'approve_private_read_owner' | 'approve_private_read_granted_agent'
        soulGrantObjectId: string | null
        documentIdHex: string
      }
      seal: {
        network: 'testnet' | 'mainnet'
        threshold: number
        verifyKeyServers: boolean
        serverConfigs: Array<{
          objectId: string
          weight: number
          aggregatorUrl?: string
        }>
      }
      sealSidecar: SealEnvelopeSidecar
      viewerAddress: string
      accessKind: SkillAccessKind
      sessionTtlMin: number
    }

export interface ResolvedPersonalKiosk {
  ownerAddress: string
  currentKioskId: string
  currentKioskCapOnChainId: string
}

export type ResolvePersonalKioskResult =
  | { status: 'ready'; kiosk: ResolvedPersonalKiosk }
  | { status: 'missing' }

export interface SoulMintSyncPayload {
  txDigest: string
  soulOnChainId: string
  stateOnChainId: string
  memoryOnChainId: string
}
