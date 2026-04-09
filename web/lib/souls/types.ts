import type { SealEnvelopeSidecar } from '@web/lib/services/seal-crypto'

export interface SoulAssetSummary {
  id: string
  onChainId: string
  name: string
  description: string
  imageUrl: string
  category: string
  tags: string[]
  previewImages: string[]
  creatorRoyaltyBps: number
  listingObjectOnChainId: string | null
  listedPriceAtomic: string | null
  listingStatus: 'listed' | 'held'
  creatorAddress: string
  currentOwnerAddress: string
  currentKioskId: string
  createdAt: string
  updatedAt: string
}

export interface SoulAssetDetail extends SoulAssetSummary {
  metadataRef: string | null
  contentBlobId: string | null
  contentBlobObjectId: string | null
  currentKioskCapOnChainId: string | null
  readme: string | null
  allowlistAddress: string | null
  allowlistCapOnChainId: string | null
  allowlistVersion: string | null
  creatorMemberId: string | null
  currentOwnerMemberId: string | null
  purchasePlatformFeeAtomic: string | null
  purchaseCreatorRoyaltyAtomic: string | null
  purchaseTotalAtomic: string | null
  quotedPriceAtomic: string | null
  isOwner: boolean
  isCreator: boolean
  isAllowlisted: boolean
}

export interface SoulsListResponse {
  items: SoulAssetSummary[]
  total: number
  page: number
  totalPages: number
}

export interface MySoulsResponse {
  authored: SoulAssetSummary[]
  owned: SoulAssetSummary[]
  allowlisted: SoulAssetSummary[]
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
    moduleName: 'seal_policy'
    functionName: 'seal_approve_owner_in_personal_kiosk' | 'seal_approve_allowlisted'
    currentKioskId: string | null
    currentKioskCapOnChainId: string | null
    allowlistRegistryObjectId: string | null
    soulAllowlistCapObjectId: string | null
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
  accessKind: 'owner' | 'allowlisted'
  sessionTtlMin: number
}

export type PurchaseStatus = 'idle' | 'creating' | 'signing' | 'confirming' | 'settling' | 'done' | 'error'
