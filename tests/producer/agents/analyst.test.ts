import { describe, it, expect } from 'vitest'
import { parseAnalystResponse, ANALYST_SYSTEM_PROMPT } from '../../../src/producer/agents/analyst.js'

describe('analyst agent', () => {
  it('parses valid analyst response', () => {
    const json = JSON.stringify({
      body_zh: '详细分析内容...',
      tags: ['DeFi', 'Sui'],
      companies: [{ name: 'Mysten Labs', category: 'Infrastructure', description: 'Sui 背后的公司' }],
    })
    const result = parseAnalystResponse(json)
    expect(result.body_zh).toBe('详细分析内容...')
    expect(result.tags).toEqual(['DeFi', 'Sui'])
    expect(result.companies).toHaveLength(1)
  })

  it('throws on missing body_zh', () => {
    const json = JSON.stringify({ tags: [] })
    expect(() => parseAnalystResponse(json)).toThrow('body_zh')
  })

  it('defaults tags and companies to empty arrays', () => {
    const json = JSON.stringify({ body_zh: '内容' })
    const result = parseAnalystResponse(json)
    expect(result.tags).toEqual([])
    expect(result.companies).toEqual([])
  })

  it('repairs malformed JSON with unescaped quotes in body_zh', () => {
    const malformed = `{
  "body_zh": "CoinDesk 表示 "BTC ETF" 今日流入放大，机构风险偏好回升",
  "tags": ["BTC", "ETF"],
  "companies": []
}`

    const result = parseAnalystResponse(malformed)

    expect(result.body_zh).toContain('"BTC ETF"')
    expect(result.tags).toEqual(['BTC', 'ETF'])
    expect(result.companies).toEqual([])
  })
})
