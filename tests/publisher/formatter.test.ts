import { describe, it, expect } from 'vitest'
import { formatArticle } from '../../src/publisher/formatter.js'

describe('formatArticle', () => {
  it('formats article for Telegram', () => {
    const msg = formatArticle({
      title_zh: '测试标题',
      summary_zh: '中文摘要内容',
      analysis_zh: '中文深度解读',
      tags: '["ai","web3"]',
      source_url: 'https://example.com/article',
    })

    expect(msg).toContain('测试标题')
    expect(msg).toContain('中文摘要内容')
    expect(msg).toContain('中文深度解读')
    expect(msg).toContain('https://example.com/article')
    expect(msg).toContain('#ai')
    expect(msg).toContain('ClawNews')
  })

  it('handles missing optional fields', () => {
    const msg = formatArticle({
      title_zh: '标题',
      summary_zh: '摘要',
      analysis_zh: null,
      tags: null,
      source_url: 'https://example.com',
    })

    expect(msg).toContain('标题')
    expect(msg).not.toContain('null')
  })
})
