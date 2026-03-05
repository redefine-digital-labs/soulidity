import { describe, it, expect, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { getRawItemsByStatus, getArticlesByStatus } from '../../src/db/database.js'
import { runCollectors } from '../../src/collector/run.js'
import { runDedup } from '../../src/producer/dedup.js'
import { produceArticles } from '../../src/producer/produce.js'
import type { CollectedItem } from '../../src/collector/types.js'

let prisma: ReturnType<typeof createMockPrisma>['prisma']
let store: ReturnType<typeof createMockPrisma>['store']

function seedAgentRoles(store: ReturnType<typeof createMockPrisma>['store']) {
  const roles = ['scout', 'reporter', 'analyst', 'editor', 'publisher']
  for (const [i, name] of roles.entries()) {
    store.agentRoles.push({
      id: `role-${name}`,
      name,
      label: name,
      sortOrder: i + 1,
      createdAt: new Date(),
    })
  }
}

beforeEach(() => {
  const mock = createMockPrisma()
  prisma = mock.prisma
  store = mock.store
  seedAgentRoles(store)
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

    // 3. Produce — pipeline calls LLM 3 times per article: reporter, analyst, editor
    let callIndex = 0
    const mockResponses = [
      JSON.stringify({ title_zh: 'AI Agent 在 Sui 链上启动', lead_zh: '据 coindesk 报道，一个新的 AI Agent 框架在 Sui 区块链上推出。' }),
      JSON.stringify({ body_zh: '这表明 AI 与区块链的结合正在加速。', tags: ['ai-agent', 'sui', 'defi'], companies: [{ name: 'Sui', category: 'L1/L2', description: '高性能 Layer1 区块链' }] }),
      JSON.stringify({ title_zh: 'AI Agent 在 Sui 链上启动', summary_zh: '据 coindesk 报道，一个新的 AI Agent 框架在 Sui 区块链上推出。', analysis_zh: '这表明 AI 与区块链的结合正在加速。', quality_score: 8, approved: true }),
    ]
    const mockLLM = {
      async generate(_system: string, _user: string): Promise<string> {
        const response = mockResponses[callIndex % mockResponses.length]
        callIndex++
        return response
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

    // Verify company was created
    const companies = await prisma.company.findMany({})
    expect(companies).toHaveLength(1)
    expect(companies[0].name).toBe('Sui')
  })
})
