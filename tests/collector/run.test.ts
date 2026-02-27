import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createDb, getRawItemsByStatus } from '../../src/db/database.js'
import { runCollectors } from '../../src/collector/run.js'
import type { CollectedItem } from '../../src/collector/types.js'

let db: Database.Database

beforeEach(() => {
  db = createDb(':memory:')
})

afterEach(() => {
  db.close()
})

const mockCollector = (): Promise<CollectedItem[]> => Promise.resolve([
  { source_type: 'rss', source_name: 'test', title: 'AI Agent for DeFi', url: 'https://test.com/1', content: 'AI agent content', language: 'en', raw_data: {} },
  { source_type: 'rss', source_name: 'test', title: 'Bitcoin Price', url: 'https://test.com/2', content: 'crypto news', language: 'en', raw_data: {} },
])

describe('runCollectors', () => {
  it('collects, scores, and inserts items', async () => {
    const result = await runCollectors(db, [mockCollector])
    expect(result.total).toBe(2)
    expect(result.inserted).toBe(2)

    const items = getRawItemsByStatus(db, 'new')
    expect(items).toHaveLength(2)
    // AI Agent item should have higher score and come first
    expect(items[0].title).toBe('AI Agent for DeFi')
    expect(items[0].score).toBeGreaterThan(items[1].score)
  })

  it('deduplicates on second run', async () => {
    await runCollectors(db, [mockCollector])
    const result2 = await runCollectors(db, [mockCollector])
    expect(result2.inserted).toBe(0)
  })
})
