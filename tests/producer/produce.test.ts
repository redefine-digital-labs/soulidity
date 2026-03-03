import { describe, it, expect, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { insertRawItem, getRawItemsByStatus, updateRawItemStatus, getArticlesByStatus } from '../../src/db/database.js'
import { produceArticles, parseResponse } from '../../src/producer/produce.js'
import { createMockLLM } from './llm.test.js'

let prisma: ReturnType<typeof createMockPrisma>['prisma']

beforeEach(() => {
  const mock = createMockPrisma()
  prisma = mock.prisma
})

describe('parseResponse', () => {
  it('parses valid JSON', () => {
    const result = parseResponse(JSON.stringify({
      title_zh: '标题',
      summary_zh: '摘要',
      analysis_zh: '解读',
      tags: ['ai'],
    }))
    expect(result.title_zh).toBe('标题')
  })

  it('strips markdown fences', () => {
    const result = parseResponse('```json\n{"title_zh":"标题","summary_zh":"s","analysis_zh":"a","tags":[]}\n```')
    expect(result.title_zh).toBe('标题')
  })

  it('throws on missing required fields', () => {
    expect(() => parseResponse('{"title_zh":"only one field"}')).toThrow('Missing required field')
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

    const mockLLM = createMockLLM({
      title_zh: '测试标题',
      summary_zh: '中文摘要',
      analysis_zh: '中文解读',
      tags: ['ai', 'web3'],
    })

    const result = await produceArticles(prisma, mockLLM)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)

    expect(await getRawItemsByStatus(prisma, 'produced')).toHaveLength(1)
    expect(await getRawItemsByStatus(prisma, 'deduped')).toHaveLength(0)

    const articles = await getArticlesByStatus(prisma, 'draft')
    expect(articles).toHaveLength(1)
    expect(articles[0].title_zh).toBe('测试标题')
  })

  it('marks item as rejected on LLM failure', async () => {
    const id = await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'test', title: 'Bad',
      url: 'https://test.com/bad', title_hash: null, content: '',
      language: 'en', score: 1, raw_data: null,
    })
    await updateRawItemStatus(prisma, id!, 'deduped')

    const failingLLM = {
      async generate(): Promise<string> { throw new Error('API error') },
    }

    const result = await produceArticles(prisma, failingLLM)
    expect(result.failed).toBe(1)
    expect(await getRawItemsByStatus(prisma, 'rejected')).toHaveLength(1)
  })
})
