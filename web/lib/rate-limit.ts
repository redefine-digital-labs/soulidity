import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import {
  resetRateLimitBucketsForTests,
  takeRateLimitTokenWithFallback,
  type RateLimitOptions,
} from '@web/lib/rate-limit-core'

export const MISSING_CLIENT_IP_ERROR = 'Unable to determine client IP'

// ---------------------------------------------------------------------------
// Redis-backed rate limiter (Upstash) with in-memory fallback for local dev
// and transient Upstash/network failures.
// ---------------------------------------------------------------------------

const globalRateLimitState = globalThis as typeof globalThis & {
  __clawnewsUpstashRedis?: Redis
}

// --- Upstash Redis (production) ---

function getRedis(): Redis | null {
  if (globalRateLimitState.__clawnewsUpstashRedis) {
    return globalRateLimitState.__clawnewsUpstashRedis
  }
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
  if (!url || !token) return null

  const redis = new Redis({ url, token })
  globalRateLimitState.__clawnewsUpstashRedis = redis
  return redis
}

function createUpstashLimiter(opts: RateLimitOptions): Ratelimit | null {
  const redis = getRedis()
  if (!redis) return null
  const windowSec = Math.max(1, Math.ceil(opts.windowMs / 1000))
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(opts.max, `${windowSec} s`),
    prefix: 'clawnews:rl',
  })
}

// ---------------------------------------------------------------------------
// Public API — same interface as before
// ---------------------------------------------------------------------------

export async function takeRateLimitToken(
  key: string,
  options: RateLimitOptions,
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const limiter = createUpstashLimiter(options)
  return takeRateLimitTokenWithFallback({
    key,
    options,
    takeRemoteToken: limiter ? () => limiter.limit(key) : null,
  })
}

// --- IP resolution (unchanged) ---

function trustsProxyHeaders(): boolean {
  return process.env.TRUST_PROXY_HEADERS === 'true'
    || process.env.VERCEL === '1'
    || process.env.VERCEL === 'true'
    || Boolean(process.env.VERCEL_ENV)
}

export function getRequestIp(headers: Headers): string | null {
  if (!trustsProxyHeaders()) return null
  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  const forwardedFor = headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }
  return null
}

// --- Test helpers ---
export { resetRateLimitBucketsForTests }
