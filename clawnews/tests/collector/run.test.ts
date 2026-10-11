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
  { source_type: 'rss', source_name: 'test', title: 'OpenClaw AI Agent launches new DeFi tool', url: 'https://test.com/1', content: 'OpenClaw announced a new AI agent platform', language: 'en', raw_data: {} },
  { source_type: 'rss', source_name: 'test', title: 'Claude and Cursor integration announced', url: 'https://test.com/2', content: 'Anthropic Claude now works with Cursor IDE', language: 'en', raw_data: {} },
])

describe('runCollectors', () => {
  it('collects, scores, and inserts items', async () => {
    const result = await runCollectors(prisma, [mockCollector])
    expect(result.total).toBe(2)
    expect(result.inserted).toBe(2)

    const items = await getRawItemsByStatus(prisma, 'new')
    expect(items).toHaveLength(2)
    // OpenClaw item should have higher score and come first
    expect(items[0].title).toBe('OpenClaw AI Agent launches new DeFi tool')
    expect(items[0].score).toBeGreaterThan(items[1].score)
  })

  it('skipped field returned', async () => {
    const result = await runCollectors(prisma, [mockCollector])
    expect(result.skipped).toBe(0)
  })

  it('skips items that collapse to the same canonical URL', async () => {
    const collector = (): Promise<CollectedItem[]> => Promise.resolve([
      { source_type: 'rss', source_name: 'test', title: 'OpenClaw launches new feature', url: 'https://test.com/story?id=1&utm_source=rss', content: 'OpenClaw update', language: 'en', raw_data: {} },
      { source_type: 'rss', source_name: 'test', title: 'OpenClaw launches new feature mirror', url: 'https://test.com/story?utm_medium=social&id=1', content: 'OpenClaw update', language: 'en', raw_data: {} },
    ])

    const result = await runCollectors(prisma, [collector])

    expect(result.total).toBe(2)
    expect(result.inserted).toBe(1)
    expect(result.skipped).toBe(1)

    const items = await getRawItemsByStatus(prisma, 'new')
    expect(items).toHaveLength(1)
    expect(items[0].url).toBe('https://test.com/story?id=1')
  })
})
