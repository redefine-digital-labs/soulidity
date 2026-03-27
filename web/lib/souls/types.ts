export interface SoulAssetSummary {
  id: string
  onChainId: string
  name: string
  description: string
  imageUrl: string
  category: string
  tags: string[]
  previewImages: string[]
  listedPriceSui: string | null
  listingStatus: 'listed' | 'held'
  creatorAddress: string
  currentOwnerAddress: string
  createdAt: string
  updatedAt: string
}

export interface SoulAssetDetail extends SoulAssetSummary {
  metadataRef: string | null
  contentBlobId: string
  contentBlobObjectId: string
  sellerKioskId: string | null
  readme: string | null
  agentGrantAddress: string | null
  agentAccessCapOnChainId: string | null
  grantVersion: string
  creatorMemberId: string | null
  currentOwnerMemberId: string | null
  purchaseFeeAmountSui: string | null
  isOwner: boolean
  isCreator: boolean
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
}

export type PurchaseStatus = 'idle' | 'creating' | 'signing' | 'confirming' | 'settling' | 'done' | 'error'
