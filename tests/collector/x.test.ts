import { describe, it, expect } from 'vitest'
import { filterTweet, isRelevant, scoreTweet, CORE_KEYWORDS, EDGE_KEYWORDS } from '../../src/collector/x.js'

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
