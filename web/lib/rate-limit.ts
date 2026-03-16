type RateLimitEntry = {
  count: number
  resetAt: number
}

const globalRateLimitState = globalThis as typeof globalThis & {
  __clawnewsRateLimitBuckets?: Map<string, RateLimitEntry>
}

const buckets = globalRateLimitState.__clawnewsRateLimitBuckets ?? new Map<string, RateLimitEntry>()

if (!globalRateLimitState.__clawnewsRateLimitBuckets) {
  globalRateLimitState.__clawnewsRateLimitBuckets = buckets
}

function pruneExpiredEntries(now: number) {
  for (const [key, entry] of buckets.entries()) {
    if (entry.resetAt <= now) {
      buckets.delete(key)
    }
  }
}

export function getRequestIp(headers: Headers): string {
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const forwardedFor = headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }

  return ''
}

export function resetRateLimitBucketsForTests(): void {
  buckets.clear()
}

export function takeRateLimitToken(
  key: string,
  options: { max: number; windowMs: number }
): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  pruneExpiredEntries(now)

  const current = buckets.get(key)
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs })
    return {
      limited: false,
      retryAfterSeconds: Math.ceil(options.windowMs / 1000),
    }
  }

  if (current.count >= options.max) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    }
  }

  current.count += 1
  return {
    limited: false,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  }
}
