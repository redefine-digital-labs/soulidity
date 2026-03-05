import { describe, it, expect, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { insertRawItem, getRawItemsByStatus, updateRawItemStatus, getArticlesByStatus } from '../../src/db/database.js'
import { produceArticles } from '../../src/producer/produce.js'
import { parseReporterResponse } from '../../src/producer/agents/reporter.js'
import { parseAnalystResponse } from '../../src/producer/agents/analyst.js'
import { parseEditorResponse } from '../../src/producer/agents/editor.js'
import type { LLMAdapter } from '../../src/producer/llm.js'

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

/** Creates a mock LLM that returns different responses sequentially (one per generate() call) */
function createSequentialMockLLM(responses: string[]): LLMAdapter {
  let callIndex = 0
  return {
    async generate(): Promise<string> {
      const response = responses[callIndex % responses.length]
      callIndex++
      return response
    },
  }
}

beforeEach(() => {
  const mock = createMockPrisma()
  prisma = mock.prisma
  store = mock.store
  seedAgentRoles(store)
})

describe('parseReporterResponse', () => {
  it('parses reporter format (title_zh/lead_zh)', () => {
    const result = parseReporterResponse(JSON.stringify({
      title_zh: '标题',
      lead_zh: '据消息报道，核心事实。',
    }))
    expect(result.title_zh).toBe('标题')
    expect(result.lead_zh).toBe('据消息报道，核心事实。')
  })

  it('strips markdown fences', () => {
    const result = parseReporterResponse('```json\n{"title_zh":"标题","lead_zh":"导语"}\n```')
    expect(result.title_zh).toBe('标题')
  })

  it('throws on missing required fields', () => {
    expect(() => parseReporterResponse('{"title_zh":"only one field"}')).toThrow('Missing required field')
  })
})

describe('parseAnalystResponse', () => {
  it('parses analyst format (body_zh/tags/companies)', () => {
    const result = parseAnalystResponse(JSON.stringify({
      body_zh: '详细正文。',
      tags: ['ai'],
      companies: [{ name: 'OpenAI', category: 'AI', description: '领先的AI公司' }],
    }))
    expect(result.body_zh).toBe('详细正文。')
    expect(result.tags).toEqual(['ai'])
    expect(result.companies).toHaveLength(1)
  })

  it('throws on missing body_zh', () => {
    expect(() => parseAnalystResponse('{"tags":["ai"]}')).toThrow('Missing required field')
  })
})

describe('parseEditorResponse', () => {
  it('parses editor format', () => {
    const result = parseEditorResponse(JSON.stringify({
      title_zh: '最终标题',
      summary_zh: '最终摘要',
      analysis_zh: '最终分析',
      quality_score: 8,
      approved: true,
    }))
    expect(result.title_zh).toBe('最终标题')
    expect(result.summary_zh).toBe('最终摘要')
    expect(result.approved).toBe(true)
  })

  it('throws on missing required fields', () => {
    expect(() => parseEditorResponse('{"title_zh":"only title"}')).toThrow('Missing required field')
  })
})

describe('produceArticles', () => {
  it('produces articles from raw items', async () => {
    const id = await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'coindesk', title: 'Test',
      url: 'https://test.com/1', title_hash: null, content: 'AI agent news',
      language: 'en', score: 5, raw_data: null,
    })
    await updateRawItemStatus(prisma, id!, 'deduped')

    // Pipeline calls LLM 3 times per article: reporter, analyst, editor
    const mockLLM = createSequentialMockLLM([
      JSON.stringify({ title_zh: '测试标题', lead_zh: '据 coindesk 报道，AI agent 新闻。' }),
      JSON.stringify({ body_zh: '详细正文内容。', tags: ['ai', 'web3'], companies: [{ name: 'OpenAI', category: 'AI', description: '领先的人工智能研究公司' }] }),
      JSON.stringify({ title_zh: '测试标题', summary_zh: '据 coindesk 报道，AI agent 新闻。', analysis_zh: '详细正文内容。', quality_score: 8, approved: true }),
    ])

    const result = await produceArticles(prisma, mockLLM)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)

    expect(await getRawItemsByStatus(prisma, 'produced')).toHaveLength(1)
    expect(await getRawItemsByStatus(prisma, 'deduped')).toHaveLength(0)

    const articles = await getArticlesByStatus(prisma, 'draft')
    expect(articles).toHaveLength(1)
    expect(articles[0].title_zh).toBe('测试标题')

    // Verify company was created and linked
    const companies = await prisma.company.findMany({})
    expect(companies).toHaveLength(1)
    expect(companies[0].name).toBe('OpenAI')
    expect(companies[0].slug).toBe('openai')
    expect(companies[0].mentionCount).toBe(1)

    const links = await prisma.articleCompany.findMany({})
    expect(links).toHaveLength(1)
  })

  it('marks item as rejected on LLM failure', async () => {
    const id = await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'test', title: 'Bad',
      url: 'https://test.com/bad', title_hash: null, content: '',
      language: 'en', score: 1, raw_data: null,
    })
    await updateRawItemStatus(prisma, id!, 'deduped')

    const failingLLM = {
      async generate(): Promise<string> { throw new Error('LLM failed') },
    }

    const result = await produceArticles(prisma, failingLLM)
    expect(result.failed).toBe(1)
    expect(await getRawItemsByStatus(prisma, 'rejected')).toHaveLength(1)
  })
})
