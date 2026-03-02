import { describe, it, expect, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { insertRawItem, getRawItemsByStatus, updateRawItemStatus, insertArticle, getArticlesByStatus, getArticleById, updateArticle, getStats } from '../../src/db/database.js'

let prisma: ReturnType<typeof createMockPrisma>['prisma']

beforeEach(() => {
  const mock = createMockPrisma()
  prisma = mock.prisma
})

describe('raw_items', () => {
  it('inserts and retrieves raw items', async () => {
    const id = await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'coindesk', title: 'Test Article',
      url: 'https://example.com/1', title_hash: null, content: 'Some content',
      language: 'en', score: 5.0, raw_data: null,
    })
    expect(id).toBeTruthy()
    const items = await getRawItemsByStatus(prisma, 'new')
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Test Article')
    expect(items[0].score).toBe(5.0)
  })

  it('updates status', async () => {
    const id = await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'coindesk', title: 'Test',
      url: 'https://example.com/2', title_hash: null, content: null,
      language: 'en', score: 1, raw_data: null,
    })
    await updateRawItemStatus(prisma, id!, 'produced')
    const newItems = await getRawItemsByStatus(prisma, 'new')
    const produced = await getRawItemsByStatus(prisma, 'produced')
    expect(newItems).toHaveLength(0)
    expect(produced).toHaveLength(1)
  })

  it('returns items ordered by score DESC', async () => {
    await insertRawItem(prisma, { source_type: 'rss', source_name: 'a', title: 'Low', url: 'https://a.com/1', title_hash: null, content: null, language: 'en', score: 1, raw_data: null })
    await insertRawItem(prisma, { source_type: 'rss', source_name: 'b', title: 'High', url: 'https://a.com/2', title_hash: null, content: null, language: 'en', score: 10, raw_data: null })
    const items = await getRawItemsByStatus(prisma, 'new')
    expect(items[0].title).toBe('High')
    expect(items[1].title).toBe('Low')
  })
})

describe('articles', () => {
  it('inserts and retrieves articles', async () => {
    const rawId = await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'coindesk', title: 'Raw Article',
      url: 'https://example.com/raw-1', title_hash: null, content: null,
      language: 'en', score: 5, raw_data: null,
    })
    const id = await insertArticle(prisma, {
      raw_item_id: rawId!,
      title_zh: '测试标题', title_en: 'Test Title',
      summary_zh: '中文摘要', summary_en: 'English summary',
      analysis_zh: '中文解读', analysis_en: 'English analysis',
      tags: '["ai","web3"]',
    })
    const article = await getArticleById(prisma, id)
    expect(article).toBeDefined()
    expect(article!.title_zh).toBe('测试标题')
    expect(article!.status).toBe('draft')
  })

  it('updates article fields', async () => {
    const rawId = await insertRawItem(prisma, {
      source_type: 'rss', source_name: 'coindesk', title: 'Raw',
      url: 'https://example.com/raw-2', title_hash: null, content: null,
      language: 'en', score: 1, raw_data: null,
    })
    const id = await insertArticle(prisma, {
      raw_item_id: rawId!, title_zh: '旧标题', title_en: 'Old',
      summary_zh: '摘要', summary_en: 'Summary',
      analysis_zh: null, analysis_en: null, tags: null,
    })
    await updateArticle(prisma, id, { title_zh: '新标题', status: 'reviewed' })
    const article = await getArticleById(prisma, id)
    expect(article!.title_zh).toBe('新标题')
    expect(article!.status).toBe('reviewed')
  })

  it('lists articles by status', async () => {
    const r1 = await insertRawItem(prisma, { source_type: 'rss', source_name: 'a', title: 'R1', url: 'https://a.com/r1', title_hash: null, content: null, language: 'en', score: 1, raw_data: null })
    const r2 = await insertRawItem(prisma, { source_type: 'rss', source_name: 'b', title: 'R2', url: 'https://a.com/r2', title_hash: null, content: null, language: 'en', score: 2, raw_data: null })
    await insertArticle(prisma, { raw_item_id: r1!, title_zh: 'A', title_en: 'A', summary_zh: 's', summary_en: 's', analysis_zh: null, analysis_en: null, tags: null })
    await insertArticle(prisma, { raw_item_id: r2!, title_zh: 'B', title_en: 'B', summary_zh: 's', summary_en: 's', analysis_zh: null, analysis_en: null, tags: null })
    expect(await getArticlesByStatus(prisma, 'draft')).toHaveLength(2)
    expect(await getArticlesByStatus(prisma, 'reviewed')).toHaveLength(0)
  })
})

describe('stats', () => {
  it('returns correct counts', async () => {
    const rawId = await insertRawItem(prisma, { source_type: 'rss', source_name: 'a', title: 'T', url: 'https://x.com/1', title_hash: null, content: null, language: 'en', score: 1, raw_data: null })
    await insertArticle(prisma, { raw_item_id: rawId!, title_zh: 'A', title_en: 'A', summary_zh: 's', summary_en: 's', analysis_zh: null, analysis_en: null, tags: null })
    const stats = await getStats(prisma)
    expect(stats.raw_new).toBe(1)
    expect(stats.articles_draft).toBe(1)
    expect(stats.articles_reviewed).toBe(0)
  })
})
