import OpenAI from 'openai'

export interface LLMAdapter {
  generate(systemPrompt: string, userPrompt: string): Promise<string>
}

export interface LLMConfig {
  apiKey: string
  model: string
  baseURL?: string
}

export interface ResolvedLLMRuntimeConfig extends LLMConfig {
  provider: 'openai'
  keyEnv: 'OPENAI_API_KEY'
}

export const DEFAULT_OPENAI_MODEL = 'gpt-5.3-codex-spark'

export function resolveLLMRuntimeConfig(env: NodeJS.ProcessEnv): ResolvedLLMRuntimeConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    return null
  }

  return {
    provider: 'openai',
    keyEnv: 'OPENAI_API_KEY',
    apiKey,
    model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    baseURL: env.OPENAI_BASE_URL?.trim() || undefined,
  }
}

export function createLLMAdapter(config: LLMConfig): LLMAdapter {
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
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
