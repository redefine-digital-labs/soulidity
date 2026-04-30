export type SoulTagsResponse = {
  tags: Array<{ tag: string; count: number }>
}

const TAG_CACHE_TTL_MS = 60_000

let cachedTags: { expiresAt: number; value: SoulTagsResponse } | null = null

export function getCachedSoulTags(now = Date.now()): SoulTagsResponse | null {
  return cachedTags && cachedTags.expiresAt > now ? cachedTags.value : null
}

export function setCachedSoulTags(value: SoulTagsResponse, now = Date.now()): void {
  cachedTags = { value, expiresAt: now + TAG_CACHE_TTL_MS }
}

export function resetSoulTagsCacheForTests(): void {
  cachedTags = null
}
