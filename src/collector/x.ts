import pg from 'pg'
import type { PrismaClient } from '../db/database.js'

// --- Keyword filtering ---

export const CORE_KEYWORDS = ['openclaw', 'openaiclaw']
export const EDGE_KEYWORDS = [
  'openai', 'ai agent', 'claude', 'mcp', 'cursor',
  'windsurf', 'copilot', 'devin', 'anthropic', 'ai编程', 'ai coding',
]

export function filterTweet(content: string, type: 'SHORT' | 'LONG'): boolean {
  const lower = content.toLowerCase()
  if (type === 'LONG') {
    return [...CORE_KEYWORDS, ...EDGE_KEYWORDS].some(kw => lower.includes(kw))
  }
  const coreHit = CORE_KEYWORDS.some(kw => lower.includes(kw))
  if (coreHit) return true
  const edgeHits = EDGE_KEYWORDS.filter(kw => lower.includes(kw))
  return edgeHits.length >= 2
}

// --- Tweet scoring ---

export function scoreTweet(tweet: {
  like_count: number
  retweet_count: number
  reply_count: number
  view_count: number
}): number {
  const engagement = tweet.like_count + tweet.retweet_count * 2 + tweet.reply_count
  if (engagement === 0) return 0
  const viewRatio = tweet.view_count > 0 ? engagement / tweet.view_count : 0
  return Math.min(100, Math.round(viewRatio * 1000 + Math.log10(engagement + 1) * 15))
}

// --- External DB types ---

interface XTweet {
  tweet_id: string
  content: string
  type: 'SHORT' | 'LONG'
  tweet_url: string
  posted_at: Date
  like_count: number
  retweet_count: number
  reply_count: number
  view_count: number
  username: string
  display_name: string | null
}

// --- Collector ---

let xPool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (!xPool) {
    const connectionString = process.env.X_DATABASE_URL
    if (!connectionString) throw new Error('X_DATABASE_URL is not set')
    xPool = new pg.Pool({ connectionString, max: 3 })
  }
  return xPool
}

async function fetchNewTweets(pool: pg.Pool, existingUrls: Set<string>): Promise<XTweet[]> {
  const { rows } = await pool.query<XTweet>(`
    SELECT
      t.tweet_id, t.content, t.type, t.tweet_url, t.posted_at,
      t.like_count, t.retweet_count, t.reply_count, t.view_count,
      a.username, a.display_name
    FROM tweets t
    JOIN authors a ON t.author_id = a.id
    ORDER BY t.posted_at DESC
  `)
  return rows.filter(r => !existingUrls.has(r.tweet_url))
}

export async function collectX(prisma: PrismaClient): Promise<{
  total: number
  inserted: number
  filtered: number
  pendingReview: number
}> {
  const pool = getPool()

  // Get already-processed tweet URLs from ClawNews
  const existing = await prisma.rawItem.findMany({
    where: { sourceType: 'x' },
    select: { url: true },
  })
  const existingUrls = new Set(existing.map(r => r.url))

  const newTweets = await fetchNewTweets(pool, existingUrls)

  let inserted = 0
  let filtered = 0
  let pendingReview = 0

  for (const tweet of newTweets) {
    if (!filterTweet(tweet.content, tweet.type)) {
      filtered++
      continue
    }

    const score = scoreTweet(tweet)
    const meta = JSON.stringify({
      author: tweet.username,
      display_name: tweet.display_name,
      like_count: tweet.like_count,
      retweet_count: tweet.retweet_count,
      reply_count: tweet.reply_count,
      view_count: tweet.view_count,
      tweet_type: tweet.type,
      posted_at: tweet.posted_at,
    })

    const isShort = tweet.type === 'SHORT'
    const status = isShort ? 'pending_review' : 'new'
    const title = isShort ? tweet.content.slice(0, 100) : tweet.content.slice(0, 60)
    const body = tweet.content

    try {
      await prisma.rawItem.create({
        data: {
          sourceType: 'x',
          sourceName: `x:${tweet.username}`,
          title,
          url: tweet.tweet_url,
          content: body,
          language: 'zh',
          score,
          status,
          rawData: meta,
        },
      })
      inserted++
      if (isShort) pendingReview++
    } catch (err: any) {
      if (err?.code === 'P2002') {
        console.log(`  skipped (already exists): ${tweet.tweet_url}`)
      } else {
        throw err
      }
    }
  }

  return { total: newTweets.length, inserted, filtered, pendingReview }
}
