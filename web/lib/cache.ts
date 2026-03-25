/**
 * Simple in-memory TTL cache for API routes.
 * Suitable for single-instance or short-lived serverless where
 * cross-instance consistency is not critical.
 */

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const store = new Map<string, CacheEntry<unknown>>()

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const entry = store.get(key) as CacheEntry<T> | undefined
  if (entry && entry.expiresAt > now) {
    return entry.data
  }
  const data = await fn()
  store.set(key, { data, expiresAt: now + ttlMs })
  return data
}
