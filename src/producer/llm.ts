import OpenAI from 'openai'
import { logger } from '../shared/logger.js'

const log = logger.child('llm')

export interface LLMAdapter {
  generate(systemPrompt: string, userPrompt: string): Promise<string>
}

export interface LLMConfig {
  apiKey: string
  model: string
  baseURL: string
}

export interface ResolvedLLMRuntimeConfig extends LLMConfig {
  provider: 'deepseek'
  keyEnv: 'DEEPSEEK_API_KEY'
}

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

export function resolveLLMRuntimeConfig(env: NodeJS.ProcessEnv): ResolvedLLMRuntimeConfig | null {
  const configuredDefault = env.DEFAULT_PROVIDER?.trim()
  const provider = configuredDefault?.startsWith('deepseek-')
    ? 'deepseek'
    : (configuredDefault || 'deepseek').toLowerCase()
  if (provider !== 'deepseek') {
    throw new Error(`Unsupported DEFAULT_PROVIDER for producer LLM: ${provider}`)
  }

  const apiKey = env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    return null
  }

  const model = env.DEEPSEEK_MODEL?.trim()
    || (configuredDefault?.startsWith('deepseek-') ? configuredDefault : undefined)
    || DEFAULT_DEEPSEEK_MODEL

  return {
    provider: 'deepseek',
    keyEnv: 'DEEPSEEK_API_KEY',
    apiKey,
    model,
    baseURL: env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL,
  }
}

export function createLLMAdapter(config: LLMConfig): LLMAdapter {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  })
  return {
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const maxRetries = 2
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const response = await client.chat.completions.create({
          model: config.model,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        })
        const text = response.choices[0]?.message?.content
        if (text) return text
        if (attempt < maxRetries) {
          log.warn(`LLM returned empty response (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`)
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        }
      }
      throw new Error('Empty response from LLM after 3 attempts')
    },
  }
}
