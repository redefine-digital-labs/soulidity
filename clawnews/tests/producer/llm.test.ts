import { describe, it, expect } from 'vitest'
import type { LLMAdapter } from '../../src/producer/llm.js'

export function createMockLLM(response: object): LLMAdapter {
  return {
    async generate(): Promise<string> {
      return JSON.stringify(response)
    },
  }
}

describe('LLMAdapter interface', () => {
  it('mock adapter returns JSON string', async () => {
    const mock = createMockLLM({ title_zh: '测试' })
    const result = await mock.generate('system', 'user')
    expect(JSON.parse(result).title_zh).toBe('测试')
  })
})
