import OpenAI from 'openai'

export interface LLMAdapter {
  generate(systemPrompt: string, userPrompt: string): Promise<string>
}

export function createZaiAdapter(apiKey: string, model = 'glm-4.7'): LLMAdapter {
  const client = new OpenAI({
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey,
  })
  return {
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const response = await client.chat.completions.create({
        model,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      })
      const text = response.choices[0]?.message?.content
      if (!text) throw new Error('Empty response from LLM')
      return text
    },
  }
}
