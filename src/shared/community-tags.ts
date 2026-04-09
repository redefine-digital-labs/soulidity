const COMMUNITY_TAG_SPLIT = ','

function trimTag(value: string) {
  return value.trim()
}

export function parseCommunityTags(input: string | string[] | null | undefined): string[] {
  if (Array.isArray(input)) {
    return input.map(trimTag).filter(Boolean)
  }

  if (typeof input !== 'string' || input.trim().length === 0) {
    return []
  }

  return input.split(COMMUNITY_TAG_SPLIT).map(trimTag).filter(Boolean)
}

export function normalizeCommunityTags(input: string | string[] | null | undefined): string[] {
  const parsed = parseCommunityTags(input)
  const unique = new Set<string>()
  const normalized: string[] = []
  for (const tag of parsed) {
    if (unique.has(tag)) continue
    unique.add(tag)
    normalized.push(tag)
  }
  return normalized
}

export function serializeCommunityTags(input: string | string[] | null | undefined): string | null {
  const parsed = parseCommunityTags(input)
  return parsed.length > 0 ? parsed.join(COMMUNITY_TAG_SPLIT) : null
}
