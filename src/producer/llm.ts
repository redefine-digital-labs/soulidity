import OpenAI from 'openai'

export interface LLMAdapter {
  generate(systemPrompt: string, userPrompt: string): Promise<string>
}

export interface LLMConfig {
  apiKey: string
  baseURL: string
  model: string
}

export interface ResolvedLLMRuntimeConfig extends LLMConfig {
  provider: 'gemini' | 'zai'
  keyEnv: 'GEMINI_API_KEY' | 'ZAI_API_KEY'
}

const LLM_CONFIGS = {
  gemini: {
    keyEnv: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
  },
  zai: {
    keyEnv: 'ZAI_API_KEY',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.7',
  },
} as const

export function resolveLLMRuntimeConfig(env: NodeJS.ProcessEnv): ResolvedLLMRuntimeConfig {
  const requestedProvider = env.LLM_PROVIDER?.trim()
  const provider = requestedProvider
    ? requestedProvider
    : env.ZAI_API_KEY
      ? 'zai'
      : env.GEMINI_API_KEY
        ? 'gemini'
        : 'zai'

  if (!(provider in LLM_CONFIGS)) {
    throw new Error(`Unknown LLM_PROVIDER: ${provider}. Supported: ${Object.keys(LLM_CONFIGS).join(', ')}`)
  }

  const resolvedProvider = provider as keyof typeof LLM_CONFIGS
  const llmConfig = LLM_CONFIGS[resolvedProvider]
  const apiKey = env[llmConfig.keyEnv]
  if (!apiKey) {
    throw new Error(`${llmConfig.keyEnv} is required for LLM_PROVIDER=${resolvedProvider}`)
  }

  return {
    provider: resolvedProvider,
    keyEnv: llmConfig.keyEnv,
    apiKey,
    baseURL: llmConfig.baseURL,
    model: env.LLM_MODEL?.trim() || llmConfig.model,
  }
}

export function createLLMAdapter(config: LLMConfig): LLMAdapter {
  const client = new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
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
          console.warn(`LLM returned empty response (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`)
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
        }
      }
      throw new Error('Empty response from LLM after 3 attempts')
    },
  }
}

/** @deprecated Use createLLMAdapter instead */
export function createZaiAdapter(apiKey: string, model = 'glm-4.7'): LLMAdapter {
  return createLLMAdapter({
    apiKey,
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model,
  })
}
