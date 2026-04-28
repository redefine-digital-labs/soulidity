import { describe, expect, it } from 'vitest'

import { DEFAULT_DEEPSEEK_MODEL, resolveAdminLLMRuntimeConfig } from '../../web/lib/admin-llm.ts'

describe('resolveAdminLLMRuntimeConfig', () => {
  it('uses DEFAULT_PROVIDER as the DeepSeek model when it contains a model id', () => {
    const config = resolveAdminLLMRuntimeConfig({
      DEFAULT_PROVIDER: 'deepseek-v4-flash',
      DEEPSEEK_API_KEY: 'deepseek-secret',
    })

    expect(config.provider).toBe('deepseek')
    expect(config.keyEnv).toBe('DEEPSEEK_API_KEY')
    expect(config.apiKey).toBe('deepseek-secret')
    expect(config.model).toBe('deepseek-v4-flash')
    expect(config.baseURL).toBe('https://api.deepseek.com')
  })

  it('supports explicit DeepSeek model and base URL overrides', () => {
    const config = resolveAdminLLMRuntimeConfig({
      DEFAULT_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'deepseek-secret',
      DEEPSEEK_MODEL: 'deepseek-v4-pro',
      DEEPSEEK_BASE_URL: 'https://deepseek.example',
    })

    expect(config.model).toBe('deepseek-v4-pro')
    expect(config.baseURL).toBe('https://deepseek.example')
  })

  it('defaults to the current DeepSeek non-thinking model', () => {
    const config = resolveAdminLLMRuntimeConfig({
      DEEPSEEK_API_KEY: 'deepseek-secret',
    })

    expect(config.model).toBe(DEFAULT_DEEPSEEK_MODEL)
  })

  it('throws for unsupported providers and missing keys', () => {
    expect(() => resolveAdminLLMRuntimeConfig({
      DEFAULT_PROVIDER: 'openai',
      DEEPSEEK_API_KEY: 'deepseek-secret',
    })).toThrow('Unsupported DEFAULT_PROVIDER for admin LLM: openai')

    expect(() => resolveAdminLLMRuntimeConfig({
      DEFAULT_PROVIDER: 'deepseek-v4-flash',
    })).toThrow('DEEPSEEK_API_KEY is required')
  })
})
