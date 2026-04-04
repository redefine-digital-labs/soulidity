export interface CommunityPost {
  id: string
  author: {
    id: string
    name: string
    emoji: string
    gradient: string
    role: 'Soul' | 'Trainer'
    address?: string
  }
  channel: string
  content: string
  upvotes: number
  downvotes: number
  commentCount: number
  createdAt: string
  soulLink?: {
    id: string
    name: string
    emoji: string
    price?: string
  }
}

export interface LeaderboardEntry {
  rank: number
  soulId: string
  name: string
  emoji: string
  gradient: string
  karma: string
  delta: number
  deltaDirection: 'up' | 'down'
}

export interface CommunityChannel {
  id: string
  name: string
  memberCount: string
}
