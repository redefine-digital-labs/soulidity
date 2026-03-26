type RateLimitEntry = {
  count: number
  resetAt: number
}

export type RateLimitOptions = {
  max: number
  windowMs: number
}

export type RateLimitResult = {
  limited: boolean
  retryAfterSeconds: number
}

const RATE_LIMIT_PRUNE_INTERVAL_MS = 10_000
const globalRateLimitState = globalThis as typeof globalThis & {
  __clawnewsRateLimitBuckets?: Map<string, RateLimitEntry>
  __clawnewsRateLimitLastPruneAt?: number
}

const buckets = globalRateLimitState.__clawnewsRateLimitBuckets ?? new Map<string, RateLimitEntry>()
if (!globalRateLimitState.__clawnewsRateLimitBuckets) {
  globalRateLimitState.__clawnewsRateLimitBuckets = buckets
}

function pruneExpiredEntries(now: number) {
  const lastPruneAt = globalRateLimitState.__clawnewsRateLimitLastPruneAt ?? 0
  if (now - lastPruneAt < RATE_LIMIT_PRUNE_INTERVAL_MS) return
  globalRateLimitState.__clawnewsRateLimitLastPruneAt = now
  for (const [key, entry] of buckets.entries()) {
    if (entry.resetAt <= now) buckets.delete(key)
  }
}

export function inMemoryTakeToken(
  key: string,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now()
  pruneExpiredEntries(now)

  const current = buckets.get(key)
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs })
    return { limited: false, retryAfterSeconds: Math.ceil(options.windowMs / 1000) }
  }
  if (current.count >= options.max) {
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) }
  }
  current.count += 1
  return { limited: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) }
}

export async function takeRateLimitTokenWithFallback(params: {
  key: string
  options: RateLimitOptions
  takeRemoteToken?: (() => Promise<{ success: boolean; reset: number }>) | null
}): Promise<RateLimitResult> {
  if (params.takeRemoteToken) {
    try {
      const { success, reset } = await params.takeRemoteToken()
      const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
      return { limited: !success, retryAfterSeconds }
    } catch {
      // Degrade gracefully instead of turning transient remote limiter
      // failures into 500s on critical request paths.
    }
  }

  return inMemoryTakeToken(params.key, params.options)
}

export function resetRateLimitBucketsForTests(): void {
  buckets.clear()
  globalRateLimitState.__clawnewsRateLimitLastPruneAt = 0
}
