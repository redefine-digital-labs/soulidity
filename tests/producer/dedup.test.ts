import { describe, it, expect, beforeEach } from 'vitest'
import { normalize, jaccard, dedup } from '../../src/producer/dedup.js'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { insertRawItem, getRawItemsByStatus } from '../../src/db/database.js'
import { runDedup } from '../../src/producer/dedup.js'

describe('normalize', () => {
  it('lowercases and removes punctuation', () => {
    expect(normalize('Hello, World!')).toEqual(['hello', 'world'])
  })

  it('removes stop words', () => {
    expect(normalize('The quick brown fox is in the house')).toEqual(['quick', 'brown', 'fox', 'house'])
  })

  it('removes single-char tokens', () => {
    expect(normalize('A B C long word')).toEqual(['long', 'word'])
  })
})

describe('jaccard', () => {
  it('returns 1 for identical sets', () => {
    expect(jaccard(['ai', 'crypto'], ['ai', 'crypto'])).toBe(1)
  })

  it('returns 0 for disjoint sets', () => {
    expect(jaccard(['ai', 'crypto'], ['dog', 'cat'])).toBe(0)
  })

  it('returns correct similarity', () => {
    // intersection=1 (ai), union=3 (ai,crypto,bitcoin)
    expect(jaccard(['ai', 'crypto'], ['ai', 'bitcoin'])).toBeCloseTo(1 / 3)
  })

  it('handles empty arrays', () => {
    expect(jaccard([], [])).toBe(1)
    expect(jaccard(['ai'], [])).toBe(0)
    expect(jaccard([], ['ai'])).toBe(0)
  })
})

describe('dedup', () => {
  it('returns empty for no items', () => {
    const result = dedup([])
    expect(result.keep).toEqual([])
    expect(result.duplicate).toEqual([])
  })

  it('keeps all items when titles are unrelated', () => {
    const items = [
      makeItem('1', 'AI Agents Transform DeFi', 5),
      makeItem('2', 'Bitcoin Price Crashes Today', 3),
      makeItem('3', 'New Solana NFT Marketplace Launches', 2),
    ]
    const result = dedup(items)
    expect(result.keep).toHaveLength(3)
    expect(result.duplicate).toHaveLength(0)
  })

  it('groups similar titles and keeps highest score', () => {
    const items = [
      makeItem('1', 'Iran Bans Bitcoin Mining Operations', 3),
      makeItem('2', 'Iran Bitcoin Mining Ban Announced', 5),
      makeItem('3', 'Iran Stops Bitcoin Mining Activities', 2),
      makeItem('4', 'Solana DeFi Protocol Launches', 4),
    ]
    const result = dedup(items)
    expect(result.keep).toContain('2') // highest score in Iran group
    expect(result.keep).toContain('4') // unrelated, kept
    expect(result.keep).toHaveLength(2)
    expect(result.duplicate).toHaveLength(2)
    expect(result.duplicate).toContain('1')
    expect(result.duplicate).toContain('3')
  })

  it('handles single item', () => {
    const result = dedup([makeItem('1', 'Test Title', 5)])
    expect(result.keep).toEqual(['1'])
    expect(result.duplicate).toEqual([])
  })
})

describe('runDedup integration', () => {
  let prisma: ReturnType<typeof createMockPrisma>['prisma']

  beforeEach(() => {
    const mock = createMockPrisma()
    prisma = mock.prisma
  })

  it('marks items as deduped or duplicate in DB', async () => {
    await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'a', title: 'Iran Bans Bitcoin Mining',
      url: 'https://a.com/1', title_hash: null, content: null,
      language: 'en', score: 3, raw_data: null,
    })
    await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'b', title: 'Iran Bitcoin Mining Ban',
      url: 'https://b.com/1', title_hash: null, content: null,
      language: 'en', score: 5, raw_data: null,
    })
    await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'c', title: 'Solana DeFi Protocol Launches',
      url: 'https://c.com/1', title_hash: null, content: null,
      language: 'en', score: 4, raw_data: null,
    })

    const result = await runDedup(prisma)
    expect(result.total).toBe(3)
    expect(result.kept).toBe(2)
    expect(result.duplicates).toBe(1)

    const deduped = await getRawItemsByStatus(prisma, 'deduped')
    const duplicates = await getRawItemsByStatus(prisma, 'duplicate')
    expect(deduped).toHaveLength(2)
    expect(duplicates).toHaveLength(1)

    // The higher-score Iran item should be kept
    const iranDeduped = deduped.find(i => i.title.includes('Iran'))
    expect(iranDeduped?.score).toBe(5)
  })

  it('returns zero when no new items', async () => {
    const result = await runDedup(prisma)
    expect(result.total).toBe(0)
    expect(result.kept).toBe(0)
  })
})

function makeItem(id: string, title: string, score: number) {
  return {
    id,
    source_type: 'rss' as const,
    source_name: 'test',
    title,
    url: `https://test.com/${id}`,
    title_hash: null,
    content: null,
    language: 'en',
    score,
    status: 'new' as const,
    raw_data: null,
    created_at: new Date().toISOString(),
  }
}
