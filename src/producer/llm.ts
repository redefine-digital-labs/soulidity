import Anthropic from '@anthropic-ai/sdk'

export interface LLMAdapter {
  generate(systemPrompt: string, userPrompt: string): Promise<string>
}

export function createAnthropicAdapter(apiKey: string, model = 'claude-sonnet-4-6'): LLMAdapter {
  const client = new Anthropic({ apiKey })
  return {
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const response = await client.messages.create({
        model,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      })
      const block = response.content[0]
      if (block.type !== 'text') throw new Error('Unexpected response type')
      return block.text
    },
  }
}
