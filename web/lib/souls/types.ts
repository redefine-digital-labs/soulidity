export interface SoulSeriesListItem {
  id: string
  onChainId: string
  name: string
  description: string
  category: string
  tags: string[]
  previewImages: string[]
  oneTimePriceUsdc: string | null
  oneTimePlanOnChainId: string | null
  subPriceUsdc: string | null
  subPlanOnChainId: string | null
  subPeriodDays: number | null
  createdAt: string
  latestRelease: SoulRelease | null
  _count: { passSnapshots: number }
}

export interface SoulRelease {
  id: string
  onChainId: string
  version: string
  changelog: string | null
  createdAt: string
}

export interface SoulSeriesDetail extends SoulSeriesListItem {
  authorMemberId: string | null
  authorAddress: string
  readme: string | null
  status: string
  releases: SoulRelease[]
  userPass: SoulPassSnapshot | null
}

export interface SoulPassSnapshot {
  id: string
  onChainId: string
  passType: 'perpetual' | 'subscription'
  lockedReleaseId: string | null
  expiresAt: string | null
  agentGrant: string | null
  status: string
  createdAt: string
}

export interface SoulsListResponse {
  items: SoulSeriesListItem[]
  total: number
  page: number
  totalPages: number
}

export interface MySoulsResponse {
  published: SoulSeriesListItem[]
  passes: (SoulPassSnapshot & {
    series: {
      id: string
      name: string
      category: string
      previewImages: string[]
      onChainId: string
    }
  })[]
}

export type PurchaseStatus = 'idle' | 'creating' | 'signing' | 'confirming' | 'settling' | 'done' | 'error'
