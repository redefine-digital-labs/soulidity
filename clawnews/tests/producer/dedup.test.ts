import { describe, it, expect, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { insertRawItem, getRawItemsByStatus, updateRawItemStatus } from '../../src/db/database.js'
import { dedup, runDedup } from '../../src/producer/dedup.js'

describe('dedup', () => {
  it('returns empty for no items', () => {
    const result = dedup([])
    expect(result.keep).toEqual([])
    expect(result.duplicate).toEqual([])
  })

  it('keeps all items when titles and content are unrelated', () => {
    const items = [
      makeItem('1', 'AI Agents Transform DeFi', 'A new agent framework powers DeFi automation.', 5),
      makeItem('2', 'Bitcoin Price Crashes Today', 'Macro pressure sends bitcoin lower.', 3),
      makeItem('3', 'New Solana NFT Marketplace Launches', 'A new marketplace launches for creators.', 2),
    ]
    const result = dedup(items)
    expect(result.keep).toHaveLength(3)
    expect(result.duplicate).toHaveLength(0)
  })

  it('drops duplicates that match historical active items', () => {
    const items = [
      makeItem('fresh-1', 'Circle settles treasury transfer with $68 million USDC payment', 'Circle moved 68 million dollars with USDC in half an hour to settle an internal treasury payment workflow.', 9),
      makeItem('fresh-2', 'New Solana NFT Marketplace Launches', 'A new marketplace launches for creators.', 3),
    ]

    const historical = [{
      id: 'historical-1',
      title: 'Circle moves $68 million in 30 minutes using USDC for treasury payments',
      content: 'Circle moved 68 million dollars with USDC in half an hour to settle an internal treasury payment workflow.',
      url: 'https://example.com/circle-usdc',
    }]

    const result = dedup(items, historical)
    expect(result.keep).toEqual(['fresh-2'])
    expect(result.duplicate).toEqual(['fresh-1'])
  })

  it('keeps the highest-scoring item inside the same batch', () => {
    const items = [
      makeItem('1', 'Iran Bans Bitcoin Mining Operations', 'Iran announces a new ban on bitcoin mining operations.', 3),
      makeItem('2', 'Iran Bitcoin Mining Ban Announced', 'Iran announces a new ban on bitcoin mining operations.', 5),
      makeItem('3', 'Solana DeFi Protocol Launches', 'A protocol launches on Solana for DeFi traders.', 4),
    ]

    const result = dedup(items)
    expect(result.keep).toEqual(['2', '3'])
    expect(result.duplicate).toEqual(['1'])
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
      url: 'https://a.com/1', title_hash: null, content: 'Iran bans bitcoin mining after an energy review.',
      language: 'en', score: 3, raw_data: null,
    })
    await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'b', title: 'Iran Bitcoin Mining Ban',
      url: 'https://b.com/1', title_hash: null, content: 'Iran bans bitcoin mining after an energy review.',
      language: 'en', score: 5, raw_data: null,
    })
    await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'c', title: 'Solana DeFi Protocol Launches',
      url: 'https://c.com/1', title_hash: null, content: 'A protocol launches on Solana for DeFi traders.',
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

    const iranDeduped = deduped.find(i => i.title.includes('Iran'))
    expect(iranDeduped?.score).toBe(5)
  })

  it('uses historical active rows to stop cross-batch duplicates', async () => {
    const historicalId = await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'history', title: 'Circle moves $68 million in 30 minutes using USDC for treasury payments',
      url: 'https://history.example.com/circle', title_hash: null,
      content: 'Circle moved 68 million dollars with USDC in half an hour to settle an internal treasury payment workflow.',
      language: 'en', score: 10, raw_data: null,
    })
    await updateRawItemStatus(prisma, historicalId!, 'deduped')

    await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'fresh', title: 'Circle settles treasury transfer with $68 million USDC payment',
      url: 'https://fresh.example.com/circle', title_hash: null,
      content: 'Circle moved 68 million dollars with USDC in half an hour to settle an internal treasury payment workflow.',
      language: 'en', score: 9, raw_data: null,
    })

    const result = await runDedup(prisma)
    expect(result.total).toBe(1)
    expect(result.kept).toBe(0)
    expect(result.duplicates).toBe(1)

    expect(await getRawItemsByStatus(prisma, 'deduped')).toHaveLength(1)
    expect(await getRawItemsByStatus(prisma, 'duplicate')).toHaveLength(1)
  })

  it('returns zero when no new items', async () => {
    const result = await runDedup(prisma)
    expect(result.total).toBe(0)
    expect(result.kept).toBe(0)
    expect(result.duplicates).toBe(0)
  })
})

function makeItem(id: string, title: string, content: string, score: number) {
  return {
    id,
    source_type: 'rss' as const,
    source_name: 'test',
    title,
    url: `https://test.com/${id}`,
    title_hash: null,
    content,
    language: 'en',
    score,
    status: 'new' as const,
    raw_data: null,
    created_at: new Date().toISOString(),
  }
}
