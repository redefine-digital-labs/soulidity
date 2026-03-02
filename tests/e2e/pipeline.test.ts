import { describe, it, expect, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { getRawItemsByStatus, getArticlesByStatus } from '../../src/db/database.js'
import { runCollectors } from '../../src/collector/run.js'
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

    // 2. Produce
    const mockLLM = {
      async generate(_system: string, _user: string): Promise<string> {
        return JSON.stringify({
          title_zh: 'AI Agent 在 Sui 链上启动',
          title_en: 'AI Agent Launches on Sui',
          summary_zh: '一个新的 AI Agent 框架在 Sui 区块链上推出。',
          summary_en: 'A new AI agent framework launches on Sui blockchain.',
          analysis_zh: '这表明 AI 与区块链的结合正在加速。',
          analysis_en: 'This signals accelerating convergence of AI and blockchain.',
          tags: ['ai-agent', 'sui', 'defi'],
        })
      },
    }

    const produceResult = await produceArticles(prisma, mockLLM)
    expect(produceResult.succeeded).toBe(1)

    // 3. Verify state
    const produced = await getRawItemsByStatus(prisma, 'produced')
    expect(produced).toHaveLength(1)
    const drafts = await getArticlesByStatus(prisma, 'draft')
    expect(drafts).toHaveLength(1)
    expect(drafts[0].title_zh).toBe('AI Agent 在 Sui 链上启动')
    expect(JSON.parse(drafts[0].tags!)).toContain('ai-agent')
  })
})
