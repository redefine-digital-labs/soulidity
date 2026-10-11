import OpenAI from 'openai'

export interface AdminLLMAdapter {
  generate(systemPrompt: string, userPrompt: string): Promise<string>
}

export interface AdminLLMConfig {
  provider: 'deepseek'
  keyEnv: 'DEEPSEEK_API_KEY'
  apiKey: string
  model: string
  baseURL: string
}

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

function resolveProviderAndModel(env: NodeJS.ProcessEnv) {
  const configuredDefault = env.DEFAULT_PROVIDER?.trim()
  const model = env.DEEPSEEK_MODEL?.trim()
    || (configuredDefault?.startsWith('deepseek-') ? configuredDefault : undefined)
    || DEFAULT_DEEPSEEK_MODEL
  const provider = configuredDefault?.startsWith('deepseek-')
    ? 'deepseek'
    : (configuredDefault || 'deepseek').toLowerCase()

  return { provider, model }
}

export function resolveAdminLLMRuntimeConfig(env: NodeJS.ProcessEnv): AdminLLMConfig {
  const { provider, model } = resolveProviderAndModel(env)
  if (provider !== 'deepseek') {
    throw new Error(`Unsupported DEFAULT_PROVIDER for admin LLM: ${provider}`)
  }

  const apiKey = env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is required')
  }

  return {
    provider: 'deepseek',
    keyEnv: 'DEEPSEEK_API_KEY',
    apiKey,
    model,
    baseURL: env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL,
  }
}

export function createAdminLLMAdapter(config: AdminLLMConfig): AdminLLMAdapter {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  })

  return {
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const response = await client.chat.completions.create({
        model: config.model,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      })

      const text = response.choices[0]?.message?.content
      if (!text) {
        throw new Error('Empty LLM response')
      }
      return text
    },
  }
}
