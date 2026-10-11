const MAX_TAGS = 12
const MAX_TAG_LENGTH = 50

export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>()

  for (const tag of raw) {
    const trimmed = tag.trim()
    if (!trimmed) continue
    const key = trimmed.slice(0, MAX_TAG_LENGTH).toLowerCase()
    seen.add(key)
  }

  return [...seen].slice(0, MAX_TAGS)
}
