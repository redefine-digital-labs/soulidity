type RateLimitEntry = {
  count: number
  resetAt: number
}

export const MISSING_CLIENT_IP_ERROR = 'Unable to determine client IP'

const globalRateLimitState = globalThis as typeof globalThis & {
  __clawnewsRateLimitBuckets?: Map<string, RateLimitEntry>
  __clawnewsRateLimitLastPruneAt?: number
}
const RATE_LIMIT_PRUNE_INTERVAL_MS = 10_000

const buckets = globalRateLimitState.__clawnewsRateLimitBuckets ?? new Map<string, RateLimitEntry>()

if (!globalRateLimitState.__clawnewsRateLimitBuckets) {
  globalRateLimitState.__clawnewsRateLimitBuckets = buckets
}

function pruneExpiredEntries(now: number) {
  const lastPruneAt = globalRateLimitState.__clawnewsRateLimitLastPruneAt ?? 0
  if (now - lastPruneAt < RATE_LIMIT_PRUNE_INTERVAL_MS) {
    return
  }

  globalRateLimitState.__clawnewsRateLimitLastPruneAt = now
  for (const [key, entry] of buckets.entries()) {
    if (entry.resetAt <= now) {
      buckets.delete(key)
    }
  }
}

function trustsProxyHeaders(): boolean {
  return process.env.TRUST_PROXY_HEADERS === 'true'
    || process.env.VERCEL === '1'
    || process.env.VERCEL === 'true'
    || Boolean(process.env.VERCEL_ENV)
}

export function getRequestIp(headers: Headers): string | null {
  if (!trustsProxyHeaders()) {
    return null
  }

  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const forwardedFor = headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }

  return null
}

export function resetRateLimitBucketsForTests(): void {
  buckets.clear()
  globalRateLimitState.__clawnewsRateLimitLastPruneAt = 0
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
