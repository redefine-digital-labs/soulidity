import { describe, it, expect } from 'vitest'
import { parseEditorResponse, EDITOR_SYSTEM_PROMPT } from '../../../src/producer/agents/editor.js'

describe('editor agent', () => {
  it('parses valid editor response', () => {
    const json = JSON.stringify({
      title_zh: '最终标题',
      summary_zh: '最终摘要',
      analysis_zh: '最终分析',
      quality_score: 8,
      approved: true,
    })
    const result = parseEditorResponse(json)
    expect(result.title_zh).toBe('最终标题')
    expect(result.approved).toBe(true)
    expect(result.quality_score).toBe(8)
  })

  it('throws on missing title_zh', () => {
    const json = JSON.stringify({ summary_zh: '内容', approved: true })
    expect(() => parseEditorResponse(json)).toThrow('title_zh')
  })
})
