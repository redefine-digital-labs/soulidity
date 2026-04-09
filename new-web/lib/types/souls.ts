/** Soul data as displayed in the marketplace */
export interface Soul {
  id: string
  name: string
  description: string
  tags: string[]
  creator: string
  price: string // e.g. "28 USDC"
  emoji: string
  listed: boolean
  grantId: string | null
  grantStatus: 'Active' | 'None'
  hasCharacter: boolean
  collectionId?: string
  collectionName?: string
}

/** Soul Collection data */
export interface SoulCollection {
  id: string
  name: string
  emoji: string
  bannerGradient: string
  creator: string
  launched: string
  soulCount: number
  floor: number
  volume: string
  holders: number
  royalty: number
  scPrice: number | null
  scExpiry: string | null
  description: string
  lore: string
  scState: 'listed' | 'locked' | 'not-listed' | 'held'
  soulCards: SoulCardData[]
}

export interface SoulCardData {
  id: string
  emoji: string
  name: string
  tags: string[]
  description: string
  price: string
}

/** SoulGrant authorization */
export interface SoulGrant {
  grantId: string
  agentAddress: string
  agentName: string
  status: 'Active' | 'Revoked' | 'Expired'
  createdAt: string
  expiresAt?: string
}

/** Space profile */
export interface SoulSpace {
  id: string
  name: string
  handle: string
  avatar: string
  avatarGradient: string
  bannerGradient: string
  role: 'Soul' | 'Trainer'
  bio: string
  stats: {
    souls: number
    karma: string
    followers: string
    posts: string
  }
  trainer: string | null
  joined: string
  contract: string | null
  volume: string
  ownedSouls: string[]
}
