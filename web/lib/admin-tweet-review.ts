export interface TweetReview {
  title: string
  summary: string
  reviewedAt: string
}

export interface TweetMeta {
  tweet_id?: string
  tweet_url?: string
  author?: string
  display_name?: string
  like_count?: number
  retweet_count?: number
  reply_count?: number
  view_count?: number
  tweet_type?: string
  posted_at?: string
  review?: TweetReview
}

export function parseTweetMeta(rawData: string | null): TweetMeta | null {
  if (!rawData) return null

  try {
    const parsed = JSON.parse(rawData)
    return parsed && typeof parsed === 'object' ? parsed as TweetMeta : null
  } catch {
    return null
  }
}

export function mergeTweetReview(rawData: string | null, review: TweetReview): string {
  const current = parseTweetMeta(rawData) ?? {}
  return JSON.stringify({
    ...current,
    review,
  })
}

export function buildApprovedTweetUpdate(rawData: string | null, review: TweetReview): {
  status: 'new'
  rawData: string
} {
  return {
    status: 'new',
    rawData: mergeTweetReview(rawData, review),
  }
}
