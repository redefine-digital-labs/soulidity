import { describe, expect, it } from 'vitest'
import { resolveLLMRuntimeConfig } from '../../src/producer/llm.js'

describe('resolveLLMRuntimeConfig', () => {
  it('uses OpenAI Codex Spark by default', () => {
    const config = resolveLLMRuntimeConfig({
      OPENAI_API_KEY: 'openai-secret',
    })

    expect(config.provider).toBe('openai')
    expect(config.keyEnv).toBe('OPENAI_API_KEY')
    expect(config.apiKey).toBe('openai-secret')
    expect(config.model).toBe('gpt-5.3-codex-spark')
  })

  it('honors OpenAI model and base URL overrides', () => {
    const config = resolveLLMRuntimeConfig({
      OPENAI_API_KEY: 'openai-secret',
      OPENAI_MODEL: 'gpt-custom',
      OPENAI_BASE_URL: 'https://llm.example/v1',
    })

    expect(config.provider).toBe('openai')
    expect(config.apiKey).toBe('openai-secret')
    expect(config.model).toBe('gpt-custom')
    expect(config.baseURL).toBe('https://llm.example/v1')
  })

  it('throws when OpenAI API key is missing', () => {
    expect(() => resolveLLMRuntimeConfig({
      OPENAI_MODEL: 'gpt-custom',
    })).toThrow('OPENAI_API_KEY is required')
  })
})
