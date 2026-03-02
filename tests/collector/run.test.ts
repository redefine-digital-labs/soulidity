import { describe, it, expect, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { getRawItemsByStatus } from '../../src/db/database.js'
import { runCollectors } from '../../src/collector/run.js'
import type { CollectedItem } from '../../src/collector/types.js'

let prisma: ReturnType<typeof createMockPrisma>['prisma']

beforeEach(() => {
  const mock = createMockPrisma()
  prisma = mock.prisma
})

const mockCollector = (): Promise<CollectedItem[]> => Promise.resolve([
  { source_type: 'rss', source_name: 'test', title: 'AI Agent for DeFi', url: 'https://test.com/1', content: 'AI agent content', language: 'en', raw_data: {} },
  { source_type: 'rss', source_name: 'test', title: 'Bitcoin Price', url: 'https://test.com/2', content: 'crypto news', language: 'en', raw_data: {} },
])

describe('runCollectors', () => {
  it('collects, scores, and inserts items', async () => {
    const result = await runCollectors(prisma, [mockCollector])
    expect(result.total).toBe(2)
    expect(result.inserted).toBe(2)

    const items = await getRawItemsByStatus(prisma, 'new')
    expect(items).toHaveLength(2)
    // AI Agent item should have higher score and come first
    expect(items[0].title).toBe('AI Agent for DeFi')
    expect(items[0].score).toBeGreaterThan(items[1].score)
  })

  it('skipped field returned', async () => {
    const result = await runCollectors(prisma, [mockCollector])
    expect(result.skipped).toBe(0)
  })
})
