import { describe, it, expect } from 'vitest'
import { formatArticle } from '../../src/publisher/formatter.js'

describe('formatArticle', () => {
  it('formats article in BlockBeats style', () => {
    const msg = formatArticle({
      title_zh: '测试标题',
      summary_zh: '据 TheBlock 报道，某项目完成融资。',
      analysis_zh: '详细正文段落内容。',
      source_url: 'https://example.com/article',
    })

    expect(msg).toContain('<b>测试标题</b>')
    expect(msg).toContain('CryptoOpenClaw 消息，')
    expect(msg).toContain('据 TheBlock 报道，某项目完成融资。')
    expect(msg).toContain('详细正文段落内容。')
    expect(msg).toContain('原文链接 https://example.com/article')
  })

  it('handles missing optional fields', () => {
    const msg = formatArticle({
      title_zh: '标题',
      summary_zh: '据消息，核心事实。',
      analysis_zh: null,
      source_url: 'https://example.com',
    })

    expect(msg).toContain('<b>标题</b>')
    expect(msg).toContain('CryptoOpenClaw 消息，')
    expect(msg).not.toContain('null')
  })
})
