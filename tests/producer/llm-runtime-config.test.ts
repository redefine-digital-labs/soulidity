import { describe, expect, it } from 'vitest'
import { resolveLLMRuntimeConfig } from '../../src/producer/llm.js'

describe('resolveLLMRuntimeConfig', () => {
  it('falls back to zai when LLM_PROVIDER is unset and only ZAI_API_KEY exists', () => {
    const config = resolveLLMRuntimeConfig({
      ZAI_API_KEY: 'zai-secret',
    })

    expect(config.provider).toBe('zai')
    expect(config.keyEnv).toBe('ZAI_API_KEY')
    expect(config.apiKey).toBe('zai-secret')
    expect(config.baseURL).toBe('https://open.bigmodel.cn/api/paas/v4')
    expect(config.model).toBe('glm-4.7')
  })

  it('uses gemini when explicitly requested', () => {
    const config = resolveLLMRuntimeConfig({
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-secret',
      LLM_MODEL: 'gemini-custom',
    })

    expect(config.provider).toBe('gemini')
    expect(config.keyEnv).toBe('GEMINI_API_KEY')
    expect(config.apiKey).toBe('gemini-secret')
    expect(config.model).toBe('gemini-custom')
  })

  it('throws when explicit gemini is missing GEMINI_API_KEY', () => {
    expect(() => resolveLLMRuntimeConfig({
      LLM_PROVIDER: 'gemini',
      ZAI_API_KEY: 'zai-secret',
    })).toThrow('GEMINI_API_KEY is required for LLM_PROVIDER=gemini')
  })
})
