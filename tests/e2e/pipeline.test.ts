import { describe, it, expect, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { getRawItemsByStatus, getArticlesByStatus } from '../../src/db/database.js'
import { runCollectors } from '../../src/collector/run.js'
import { runDedup } from '../../src/producer/dedup.js'
import { produceArticles } from '../../src/producer/produce.js'
import type { CollectedItem } from '../../src/collector/types.js'

let prisma: ReturnType<typeof createMockPrisma>['prisma']

beforeEach(() => {
  const mock = createMockPrisma()
  prisma = mock.prisma
})

describe('full pipeline', () => {
  it('collect -> produce -> ready for review', async () => {
    // 1. Collect
    const mockCollector = (): Promise<CollectedItem[]> => Promise.resolve([
      {
        source_type: 'rss',
        source_name: 'coindesk',
        title: 'AI Agent Launches on Sui',
        url: 'https://example.com/ai-agent',
        content: 'A new AI agent framework for DeFi on Sui blockchain',
        language: 'en',
        raw_data: { test: true },
      },
    ])

    const collectResult = await runCollectors(prisma, [mockCollector])
    expect(collectResult.inserted).toBe(1)

    // 2. Dedup
    const dedupResult = await runDedup(prisma)
    expect(dedupResult.kept).toBe(1)
    expect(dedupResult.duplicates).toBe(0)

    // 3. Produce
    const mockLLM = {
      async generate(_system: string, _user: string): Promise<string> {
        return JSON.stringify({
          title_zh: 'AI Agent 在 Sui 链上启动',
          summary_zh: '一个新的 AI Agent 框架在 Sui 区块链上推出。',
          analysis_zh: '这表明 AI 与区块链的结合正在加速。',
          tags: ['ai-agent', 'sui', 'defi'],
        })
      },
    }

    const produceResult = await produceArticles(prisma, mockLLM)
    expect(produceResult.succeeded).toBe(1)

    // 4. Verify state
    const produced = await getRawItemsByStatus(prisma, 'produced')
    expect(produced).toHaveLength(1)
    const drafts = await getArticlesByStatus(prisma, 'draft')
    expect(drafts).toHaveLength(1)
    expect(drafts[0].title_zh).toBe('AI Agent 在 Sui 链上启动')
    expect(JSON.parse(drafts[0].tags!)).toContain('ai-agent')
  })
})
