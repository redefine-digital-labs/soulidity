import { describe, it, expect } from 'vitest'
import { parseReporterResponse, REPORTER_SYSTEM_PROMPT } from '../../../src/producer/agents/reporter.js'

describe('reporter agent', () => {
  it('parses valid reporter response', () => {
    const json = JSON.stringify({
      title_zh: '测试标题',
      lead_zh: '据 CoinDesk 报道，这是一条测试新闻',
    })
    const result = parseReporterResponse(json)
    expect(result.title_zh).toBe('测试标题')
    expect(result.lead_zh).toBe('据 CoinDesk 报道，这是一条测试新闻')
  })

  it('throws on missing title_zh', () => {
    const json = JSON.stringify({ lead_zh: '内容' })
    expect(() => parseReporterResponse(json)).toThrow('title_zh')
  })

  it('has a system prompt', () => {
    expect(REPORTER_SYSTEM_PROMPT).toContain('记者')
  })
})
