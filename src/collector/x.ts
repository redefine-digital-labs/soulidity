import pg from 'pg'
import type { PrismaClient } from '../db/database.js'
import { getCollectorState, upsertCollectorState } from '../db/database.js'

// --- Keyword filtering ---

export const CORE_KEYWORDS = ['openclaw', 'openaiclaw']
export const EDGE_KEYWORDS = [
  'openai', 'ai agent', 'claude', 'mcp', 'cursor',
  'windsurf', 'copilot', 'devin', 'anthropic', 'ai编程', 'ai coding',
]

/** Tiered keyword filter: core keyword = 1 match passes, edge keywords = 2+ matches needed */
export function isRelevant(text: string): boolean {
  const lower = text.toLowerCase()
  const coreHit = CORE_KEYWORDS.some(kw => lower.includes(kw))
  if (coreHit) return true
  const edgeHits = EDGE_KEYWORDS.filter(kw => lower.includes(kw))
  return edgeHits.length >= 2
}

export function filterTweet(content: string, type: 'SHORT' | 'LONG'): boolean {
  if (type === 'LONG') {
    // LONG tweets: any single keyword match is enough
    const lower = content.toLowerCase()
    return [...CORE_KEYWORDS, ...EDGE_KEYWORDS].some(kw => lower.includes(kw))
  }
  return isRelevant(content)
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

export interface XCursor {
  lastPostedAt: Date | null
  lastTweetId: string | null
}

interface CollectXDeps {
  batchSize?: number
  fetchBatch?: (cursor: XCursor, limit: number) => Promise<XTweet[]>
  loadCursor?: (prisma: PrismaClient) => Promise<XCursor>
  saveCursor?: (prisma: PrismaClient, cursor: XCursor) => Promise<void>
}

// --- Collector ---

const DEFAULT_BATCH_SIZE = 200

let xPool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (!xPool) {
    const connectionString = process.env.X_DATABASE_URL
    if (!connectionString) throw new Error('X_DATABASE_URL is not set')
    xPool = new pg.Pool({ connectionString, max: 3 })
  }
  return xPool
}

function createPgBatchFetcher(pool: pg.Pool) {
  return async (cursor: XCursor, limit: number): Promise<XTweet[]> => {
    const { rows } = await pool.query<XTweet>(`
    SELECT
      t.tweet_id, t.content, t.type, t.tweet_url, t.posted_at,
      t.like_count, t.retweet_count, t.reply_count, t.view_count,
      a.username, a.display_name
    FROM tweets t
    JOIN authors a ON t.author_id = a.id
    WHERE (
      $1::timestamptz IS NULL
      OR t.posted_at > $1
      OR (t.posted_at = $1 AND ($2::text IS NULL OR t.tweet_id > $2))
    )
    ORDER BY t.posted_at ASC, t.tweet_id ASC
    LIMIT $3
  `, [cursor.lastPostedAt, cursor.lastTweetId, limit])
    return rows
  }
}

async function loadXCursor(prisma: PrismaClient): Promise<XCursor> {
  const state = await getCollectorState(prisma, 'x')
  return {
    lastPostedAt: state?.last_posted_at ? new Date(state.last_posted_at) : null,
    lastTweetId: state?.last_tweet_id ?? null,
  }
}

async function saveXCursor(prisma: PrismaClient, cursor: XCursor): Promise<void> {
  await upsertCollectorState(prisma, 'x', {
    last_posted_at: cursor.lastPostedAt,
    last_tweet_id: cursor.lastTweetId,
  })
}

export async function collectX(prisma: PrismaClient): Promise<{
  total: number
  inserted: number
  filtered: number
  pendingReview: number
}>
export async function collectX(prisma: PrismaClient, deps: CollectXDeps = {}): Promise<{
  total: number
  inserted: number
  filtered: number
  pendingReview: number
}> {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE
  const fetchBatch = deps.fetchBatch ?? createPgBatchFetcher(getPool())
  const loadCursor = deps.loadCursor ?? loadXCursor
  const saveCursor = deps.saveCursor ?? saveXCursor

  let cursor = await loadCursor(prisma)
  let inserted = 0
  let filtered = 0
  let pendingReview = 0
  let total = 0

  while (true) {
    const tweets = await fetchBatch(cursor, batchSize)
    if (tweets.length === 0) break

    total += tweets.length
    let batchCursor = cursor

    for (const tweet of tweets) {
      batchCursor = {
        lastPostedAt: tweet.posted_at,
        lastTweetId: tweet.tweet_id,
      }

      if (!filterTweet(tweet.content, tweet.type)) {
        filtered++
        continue
      }

      const score = scoreTweet(tweet)
      const meta = JSON.stringify({
        tweet_id: tweet.tweet_id,
        tweet_url: tweet.tweet_url,
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

      try {
        await prisma.rawItem.create({
          data: {
            sourceType: 'x',
            sourceName: `x:${tweet.username}`,
            title,
            url: tweet.tweet_url,
            content: tweet.content,
            language: 'en',
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

    await saveCursor(prisma, batchCursor)
    cursor = batchCursor

    if (tweets.length < batchSize) {
      break
    }
  }

  return { total, inserted, filtered, pendingReview }
}
