import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { getCollectorState } from '../../src/db/database.js'
import { collectX, filterTweet, isRelevant, scoreTweet, type XCursor } from '../../src/collector/x.js'

let prisma: ReturnType<typeof createMockPrisma>['prisma']

beforeEach(() => {
  const mock = createMockPrisma()
  prisma = mock.prisma
})

describe('filterTweet', () => {
  it('passes LONG tweet with any core keyword', () => {
    expect(filterTweet('Check out OpenClaw new release', 'LONG')).toBe(true)
  })

  it('passes LONG tweet with any edge keyword', () => {
    expect(filterTweet('Claude is amazing for coding', 'LONG')).toBe(true)
  })

  it('rejects LONG tweet with no keywords', () => {
    expect(filterTweet('Great weather today in Tokyo', 'LONG')).toBe(false)
  })

  it('passes SHORT tweet with core keyword', () => {
    expect(filterTweet('OpenClaw is great', 'SHORT')).toBe(true)
  })

  it('rejects SHORT tweet with only 1 edge keyword', () => {
    expect(filterTweet('Claude is nice', 'SHORT')).toBe(false)
  })

  it('passes SHORT tweet with 2+ edge keywords', () => {
    expect(filterTweet('Using Cursor with Claude is great', 'SHORT')).toBe(true)
  })

  it('is case insensitive', () => {
    expect(filterTweet('OPENCLAW rocks', 'SHORT')).toBe(true)
    expect(filterTweet('using CURSOR and CLAUDE together', 'SHORT')).toBe(true)
  })
})

describe('isRelevant (shared filter for RSS/GitHub/X)', () => {
  it('passes with core keyword', () => {
    expect(isRelevant('OpenClaw launches new feature')).toBe(true)
  })

  it('rejects with only 1 edge keyword', () => {
    expect(isRelevant('Claude is a great tool')).toBe(false)
  })

  it('passes with 2+ edge keywords', () => {
    expect(isRelevant('Using Claude with Cursor for AI coding')).toBe(true)
  })

  it('rejects irrelevant content', () => {
    expect(isRelevant('Bitcoin price surges to new high')).toBe(false)
  })
})

describe('scoreTweet', () => {
  it('returns 0 for zero engagement', () => {
    expect(scoreTweet({ like_count: 0, retweet_count: 0, reply_count: 0, view_count: 0 })).toBe(0)
  })

  it('scores higher for more engagement', () => {
    const low = scoreTweet({ like_count: 5, retweet_count: 1, reply_count: 2, view_count: 1000 })
    const high = scoreTweet({ like_count: 200, retweet_count: 50, reply_count: 30, view_count: 50000 })
    expect(high).toBeGreaterThan(low)
  })

  it('caps at 100', () => {
    const score = scoreTweet({ like_count: 10000, retweet_count: 5000, reply_count: 3000, view_count: 100 })
    expect(score).toBeLessThanOrEqual(100)
  })
})

describe('collectX', () => {
  it('syncs incrementally and advances the cursor for scanned rows, including filtered ones', async () => {
    const fetchBatch = vi.fn(async (cursor: XCursor, _limit: number) => {
      if (!cursor.lastTweetId) {
        return [
          {
            tweet_id: '100',
            content: 'Completely unrelated weather update',
            type: 'LONG' as const,
            tweet_url: 'https://x.com/openclaw/status/100',
            posted_at: new Date('2026-03-08T00:00:00.000Z'),
            like_count: 1,
            retweet_count: 0,
            reply_count: 0,
            view_count: 10,
            username: 'openclaw',
            display_name: 'OpenClaw',
          },
          {
            tweet_id: '101',
            content: 'Using Cursor with Claude for OpenClaw today',
            type: 'SHORT' as const,
            tweet_url: 'https://x.com/openclaw/status/101',
            posted_at: new Date('2026-03-08T00:05:00.000Z'),
            like_count: 10,
            retweet_count: 2,
            reply_count: 1,
            view_count: 100,
            username: 'openclaw',
            display_name: 'OpenClaw',
          },
        ]
      }

      if (cursor.lastTweetId === '101') {
        return [
          {
            tweet_id: '102',
            content: 'OpenClaw and OpenAI ship a longer launch thread',
            type: 'LONG' as const,
            tweet_url: 'https://x.com/openclaw/status/102',
            posted_at: new Date('2026-03-08T00:10:00.000Z'),
            like_count: 20,
            retweet_count: 5,
            reply_count: 3,
            view_count: 300,
            username: 'openclaw',
            display_name: 'OpenClaw',
          },
        ]
      }

      return []
    })

    const result = await collectX(prisma, {
      batchSize: 2,
      fetchBatch,
    })

    expect(result).toEqual({
      total: 3,
      inserted: 2,
      filtered: 1,
      pendingReview: 1,
    })

    expect(fetchBatch.mock.calls.map(call => call[0])).toEqual([
      { lastPostedAt: null, lastTweetId: null },
      { lastPostedAt: new Date('2026-03-08T00:05:00.000Z'), lastTweetId: '101' },
    ])

    const state = await getCollectorState(prisma, 'x')
    expect(state).toMatchObject({
      source: 'x',
      last_posted_at: '2026-03-08T00:10:00.000Z',
      last_tweet_id: '102',
    })

    const storedTweets = await prisma.rawItem.findMany({})
    const shortTweet = storedTweets.find((item: any) => item.status === 'pending_review')
    const longTweet = storedTweets.find((item: any) => item.status === 'new')

    expect(shortTweet).toBeDefined()
    expect(longTweet).toBeDefined()
    if (!shortTweet || !longTweet) throw new Error('expected both short and long tweets to be stored')

    expect(shortTweet.status).toBe('pending_review')
    expect(shortTweet.content).toBe('Using Cursor with Claude for OpenClaw today')
    expect(JSON.parse(shortTweet.rawData)).toMatchObject({
      tweet_id: '101',
      tweet_url: 'https://x.com/openclaw/status/101',
    })
    expect(longTweet.status).toBe('new')
  })
})
