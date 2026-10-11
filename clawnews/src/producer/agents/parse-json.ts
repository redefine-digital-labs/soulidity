import { jsonrepair } from 'jsonrepair'

function stripMarkdownCodeFences(text: string): string {
  return text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
}

export function parseAgentJson<T>(text: string): T {
  const cleaned = stripMarkdownCodeFences(text)

  try {
    return JSON.parse(cleaned) as T
  } catch (parseError) {
    try {
      return JSON.parse(jsonrepair(cleaned)) as T
    } catch {
      throw parseError
    }
  }
}
