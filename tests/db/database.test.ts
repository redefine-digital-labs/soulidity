import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createDb, insertRawItem, getRawItemsByStatus, updateRawItemStatus, insertArticle, getArticlesByStatus, getArticleById, updateArticle, getStats } from '../../src/db/database.js'

let db: Database.Database

beforeEach(() => {
  db = createDb(':memory:')
})

afterEach(() => {
  db.close()
})

describe('raw_items', () => {
  it('inserts and retrieves raw items', () => {
    const id = insertRawItem(db, {
      source_type: 'rss',
      source_name: 'coindesk',
      title: 'Test Article',
      url: 'https://example.com/1',
      content: 'Some content',
      language: 'en',
      score: 5.0,
      raw_data: null,
    })
    expect(id).toBeTruthy()
    const items = getRawItemsByStatus(db, 'new')
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Test Article')
    expect(items[0].score).toBe(5.0)
  })

  it('deduplicates by URL', () => {
    insertRawItem(db, {
      source_type: 'rss', source_name: 'coindesk', title: 'First',
      url: 'https://example.com/dup', content: null, language: 'en', score: 1, raw_data: null,
    })
    const id2 = insertRawItem(db, {
      source_type: 'rss', source_name: 'theblock', title: 'Second',
      url: 'https://example.com/dup', content: null, language: 'en', score: 2, raw_data: null,
    })
    expect(id2).toBeNull()
    expect(getRawItemsByStatus(db, 'new')).toHaveLength(1)
  })

  it('updates status', () => {
    const id = insertRawItem(db, {
      source_type: 'rss', source_name: 'coindesk', title: 'Test',
      url: 'https://example.com/2', content: null, language: 'en', score: 1, raw_data: null,
    })
    updateRawItemStatus(db, id!, 'produced')
    expect(getRawItemsByStatus(db, 'new')).toHaveLength(0)
    expect(getRawItemsByStatus(db, 'produced')).toHaveLength(1)
  })

  it('returns items ordered by score DESC', () => {
    insertRawItem(db, { source_type: 'rss', source_name: 'a', title: 'Low', url: 'https://a.com/1', content: null, language: 'en', score: 1, raw_data: null })
    insertRawItem(db, { source_type: 'rss', source_name: 'b', title: 'High', url: 'https://a.com/2', content: null, language: 'en', score: 10, raw_data: null })
    const items = getRawItemsByStatus(db, 'new')
    expect(items[0].title).toBe('High')
    expect(items[1].title).toBe('Low')
  })
})

describe('articles', () => {
  it('inserts and retrieves articles', () => {
    const rawId = insertRawItem(db, {
      source_type: 'rss', source_name: 'coindesk', title: 'Raw Article',
      url: 'https://example.com/raw-1', content: null, language: 'en', score: 5, raw_data: null,
    })
    const id = insertArticle(db, {
      raw_item_id: rawId!,
      title_zh: '测试标题',
      title_en: 'Test Title',
      summary_zh: '中文摘要',
      summary_en: 'English summary',
      analysis_zh: '中文解读',
      analysis_en: 'English analysis',
      tags: '["ai","web3"]',
    })
    const article = getArticleById(db, id)
    expect(article).toBeDefined()
    expect(article!.title_zh).toBe('测试标题')
    expect(article!.status).toBe('draft')
  })

  it('updates article fields', () => {
    const rawId = insertRawItem(db, {
      source_type: 'rss', source_name: 'coindesk', title: 'Raw',
      url: 'https://example.com/raw-2', content: null, language: 'en', score: 1, raw_data: null,
    })
    const id = insertArticle(db, {
      raw_item_id: rawId!, title_zh: '旧标题', title_en: 'Old',
      summary_zh: '摘要', summary_en: 'Summary',
      analysis_zh: null, analysis_en: null, tags: null,
    })
    updateArticle(db, id, { title_zh: '新标题', status: 'reviewed' })
    const article = getArticleById(db, id)
    expect(article!.title_zh).toBe('新标题')
    expect(article!.status).toBe('reviewed')
  })

  it('lists articles by status', () => {
    const r1 = insertRawItem(db, { source_type: 'rss', source_name: 'a', title: 'R1', url: 'https://a.com/r1', content: null, language: 'en', score: 1, raw_data: null })
    const r2 = insertRawItem(db, { source_type: 'rss', source_name: 'b', title: 'R2', url: 'https://a.com/r2', content: null, language: 'en', score: 2, raw_data: null })
    insertArticle(db, { raw_item_id: r1!, title_zh: 'A', title_en: 'A', summary_zh: 's', summary_en: 's', analysis_zh: null, analysis_en: null, tags: null })
    insertArticle(db, { raw_item_id: r2!, title_zh: 'B', title_en: 'B', summary_zh: 's', summary_en: 's', analysis_zh: null, analysis_en: null, tags: null })
    expect(getArticlesByStatus(db, 'draft')).toHaveLength(2)
    expect(getArticlesByStatus(db, 'reviewed')).toHaveLength(0)
  })
})

describe('stats', () => {
  it('returns correct counts', () => {
    const rawId = insertRawItem(db, { source_type: 'rss', source_name: 'a', title: 'T', url: 'https://x.com/1', content: null, language: 'en', score: 1, raw_data: null })
    insertArticle(db, { raw_item_id: rawId!, title_zh: 'A', title_en: 'A', summary_zh: 's', summary_en: 's', analysis_zh: null, analysis_en: null, tags: null })
    const stats = getStats(db)
    expect(stats.raw_new).toBe(1)
    expect(stats.articles_draft).toBe(1)
    expect(stats.articles_reviewed).toBe(0)
  })
})
