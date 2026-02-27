import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createDb, insertRawItem, getRawItemsByStatus, getArticlesByStatus } from '../../src/db/database.js'
import { produceArticles, parseResponse } from '../../src/producer/produce.js'
import { createMockLLM } from './llm.test.js'

let db: Database.Database

beforeEach(() => {
  db = createDb(':memory:')
})

afterEach(() => {
  db.close()
})

describe('parseResponse', () => {
  it('parses valid JSON', () => {
    const result = parseResponse(JSON.stringify({
      title_zh: '标题', title_en: 'Title',
      summary_zh: '摘要', summary_en: 'Summary',
      analysis_zh: '解读', analysis_en: 'Analysis',
      tags: ['ai'],
    }))
    expect(result.title_zh).toBe('标题')
  })

  it('strips markdown fences', () => {
    const result = parseResponse('```json\n{"title_zh":"标题","title_en":"T","summary_zh":"s","summary_en":"s","analysis_zh":"a","analysis_en":"a","tags":[]}\n```')
    expect(result.title_zh).toBe('标题')
  })

  it('throws on missing required fields', () => {
    expect(() => parseResponse('{"title_zh":"only one field"}')).toThrow('Missing required field')
  })
})

describe('produceArticles', () => {
  it('produces articles from raw items', async () => {
    insertRawItem(db, {
      source_type: 'rss', source_name: 'coindesk', title: 'Test',
      url: 'https://test.com/1', content: 'AI agent news', language: 'en', score: 5, raw_data: null,
    })

    const mockLLM = createMockLLM({
      title_zh: '测试标题', title_en: 'Test Title',
      summary_zh: '中文摘要', summary_en: 'English summary',
      analysis_zh: '中文解读', analysis_en: 'English analysis',
      tags: ['ai', 'web3'],
    })

    const result = await produceArticles(db, mockLLM)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)

    expect(getRawItemsByStatus(db, 'produced')).toHaveLength(1)
    expect(getRawItemsByStatus(db, 'new')).toHaveLength(0)

    const articles = getArticlesByStatus(db, 'draft')
    expect(articles).toHaveLength(1)
    expect(articles[0].title_zh).toBe('测试标题')
  })

  it('marks item as rejected on LLM failure', async () => {
    insertRawItem(db, {
      source_type: 'rss', source_name: 'test', title: 'Bad',
      url: 'https://test.com/bad', content: '', language: 'en', score: 1, raw_data: null,
    })

    const failingLLM = {
      async generate(): Promise<string> { throw new Error('API error') },
    }

    const result = await produceArticles(db, failingLLM)
    expect(result.failed).toBe(1)
    expect(getRawItemsByStatus(db, 'rejected')).toHaveLength(1)
  })
})
