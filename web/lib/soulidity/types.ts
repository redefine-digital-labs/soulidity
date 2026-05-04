import type { SealEnvelopeSidecar } from '@/lib/services/seal-crypto'

export type SoulListingStatus = 'held' | 'listed' | 'floor-violation'
export type SoulGrantStatus = 'active' | 'revoked' | 'expired' | 'superseded' | 'invalidated'
export type SoulGrantScope = 'seal' | 'memory' | 'skills' | 'assets'
export type SoulAccessKind = 'owner' | 'granted-agent'
export type SkillAccessKind = 'owner' | 'granted-agent' | 'allowlisted'
export type AssetAccessKind = 'owner' | 'granted-agent' | 'allowlisted'
export type SoulWriterKind = 'founder' | 'owner' | 'granted-agent'
export type SoulProvenanceKind = 'native' | 'imported' | 'personal-join'
export type SoulSkillVisibility = 'public' | 'private'
export type SoulAssetVisibility = 'public' | 'private'
export type SoulDownloadPolicy = 'public' | 'owner_only' | 'allowlist'

export interface SoulMetadataBindingRecord {
  assetName: string
  versionIndex: number
  downloadPolicy: SoulDownloadPolicy
}

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
  ownershipEpochSnapshot: number | null
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
  activeGrantsTableId?: string | null
  memoryId?: string | null
  metadataId: string | null
  skillsId: string | null
  assetsId: string | null
  accessListId: string | null
  collectionId: string | null
}

export interface SoulMetadataObject {
  objectId: string
  packageId: string
  soulId: string
  activeSprite: SoulMetadataBindingRecord | null
  activeVoice: SoulMetadataBindingRecord | null
  extTableId: string
  spriteConfigJson: string | null
  spriteMoodMapJson: string | null
  voiceConfigJson: string | null
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
  // null = unlimited; bigint reflects on-chain Option<u64> exactly.
  maxSupply: bigint | null
  currentSupply: bigint
}

export interface SoulCollectionRightObject {
  objectId: string
  packageId: string
  collectionId: string
  creatorAddress: string
  name: string
  description: string
  imageUrl: string
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
  entryCount: number
  entriesTableId: string
}

export interface MemoryEntryObject {
  packageId: string
  memoryId: string
  soulId: string
  timestampKey: number
  writerAddress: string
  writerKind: SoulWriterKind
  createdAtMs: number
  blobObjectId: string
  blobId: string | null
}

export interface SoulSkillsObject {
  objectId: string
  packageId: string
  soulId: string
  skillCount: number
  skillsTableId: string
}

export interface SkillVersionObject {
  packageId: string
  soulId: string
  skillsId: string
  skillName: string
  versionIndex: number
  visibility: SoulSkillVisibility
  deleted: boolean
  createdAtMs: number
  blobObjectId: string
  blobId: string | null
}

// ── Asset types ──

export type AssetType = 'sprite' | 'live2d' | 'audio'

export interface AssetVersionObject {
  soulId: string
  assetsId: string
  assetName: string
  versionIndex: number
  visibility: 'public' | 'private'
  assetType: AssetType
  blobObjectId: string
  blobId?: string | null
  createdAtMs: number
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
  metadataOnChainId: string | null
  activeSpriteAssetName: string | null
  activeSpriteVersionIndex: number | null
  activeSpriteDownloadPolicy: SoulDownloadPolicy | null
  activeVoiceAssetName: string | null
  activeVoiceVersionIndex: number | null
  activeVoiceDownloadPolicy: SoulDownloadPolicy | null
  spriteConfigJson: string | null
  spriteMoodMapJson: string | null
  voiceConfigJson: string | null
  contentBlobId: string | null
  contentBlobObjectId: string
  provenanceKind: SoulProvenanceKind
  originRef: string | null
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
  assetsOnChainId: string | null
  accessListOnChainId: string | null
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
  soulOnChainId: string
  memoryOnChainId: string
  timestampKey: number
  writerAddress: string
  writerKind: SoulWriterKind
  blobObjectId: string
  blobId: string | null
  sealSidecar?: SealEnvelopeSidecar | null
  createdAtMs: number
  createdAt: string
  updatedAt: string
}

export interface SoulSkillVersionRecord {
  id: string
  soulOnChainId: string
  skillsOnChainId: string
  skillName: string
  versionIndex: number
  visibility: SoulSkillVisibility
  deletedAt: string | null
  blobObjectId: string
  blobId: string | null
  sealSidecar: SealEnvelopeSidecar | null
  createdAtMs: number
  createdAt: string
  updatedAt: string
}

export interface SoulAssetVersionRecord {
  id: string
  soulOnChainId: string
  assetsOnChainId: string
  assetName: string
  versionIndex: number
  visibility: SoulAssetVisibility
  assetType: AssetType
  deletedAt: string | null
  blobObjectId: string
  blobId: string | null
  sealSidecar: SealEnvelopeSidecar | null
  createdAtMs: number
  createdAt: string
  updatedAt: string
}

export interface SoulAssetVersionsResponse {
  assets: SoulAssetVersionRecord[]
  nextVersionIndexes?: Record<string, number>
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
  // soulCount mirrors SoulCollection.current_supply 1:1; kept as alias for
  // legacy callers. New code should read currentSoulSupply.
  soulCount: number
  currentSoulSupply: number
  // null = unlimited supply. Atomic string to avoid bigint-in-JSON.
  maxSoulSupply: string | null
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
  skillVersionCount: number
  isOwner: boolean
  isCreator: boolean
  isGrantedAgent: boolean
  quote: SoulQuoteBreakdown | null
  platformFeeBps: number | null
}

export interface SoulSkillVersionsPageResponse {
  soulOnChainId: string
  skillsOnChainId: string | null
  items: SoulSkillVersionRecord[]
  nextCursor: string | null
  total: number
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
        skillName: string
        versionIndex: number
        moduleName: 'skills' | 'content_access'
        functionName:
          | 'seal_approve_private_read_owner'
          | 'seal_approve_private_read_granted_agent'
          | 'seal_approve_skill_allowlisted'
        soulGrantObjectId: string | null
        accessListOnChainId?: string
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

export type AssetAccessResponse =
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
        assetsObjectId: string
        assetName: string
        versionIndex: number
        moduleName: 'assets' | 'content_access'
        functionName:
          | 'seal_approve_asset_read_owner'
          | 'seal_approve_asset_read_granted_agent'
          | 'seal_approve_asset_allowlisted'
        soulGrantObjectId: string | null
        accessListOnChainId?: string
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
      accessKind: AssetAccessKind
      sessionTtlMin: number
    }

export interface MemoryAccessResponse {
  artifact: {
    walrusBlobUrl: string
    walrusBlobId: string
    blobObjectId: string
  }
  accessPolicy: {
    packageId: string
    stateObjectId: string
    memoryObjectId: string
    timestampKey: number
    moduleName: 'seal_policy'
    functionName: 'seal_approve_memory_owner' | 'seal_approve_memory_granted_agent'
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
  accessKind: SoulAccessKind
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
