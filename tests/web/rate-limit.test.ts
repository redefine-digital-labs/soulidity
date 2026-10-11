import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getRequestIp,
  resetRateLimitBucketsForTests,
  takeBestEffortRateLimitToken,
  takeRateLimitToken,
} from '@web/lib/rate-limit'

describe('getRequestIp', () => {
  const originalVercel = process.env.VERCEL
  const originalVercelEnv = process.env.VERCEL_ENV
  const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS

  beforeEach(() => {
    resetRateLimitBucketsForTests()
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    delete process.env.TRUST_PROXY_HEADERS
  })

  afterEach(() => {
    if (originalVercel === undefined) {
      delete process.env.VERCEL
    } else {
      process.env.VERCEL = originalVercel
    }
    if (originalVercelEnv === undefined) {
      delete process.env.VERCEL_ENV
    } else {
      process.env.VERCEL_ENV = originalVercelEnv
    }
    if (originalTrustProxyHeaders === undefined) {
      delete process.env.TRUST_PROXY_HEADERS
    } else {
      process.env.TRUST_PROXY_HEADERS = originalTrustProxyHeaders
    }
  })

  it('ignores client-supplied proxy headers when proxy trust is not enabled', () => {
    expect(getRequestIp(new Headers({
      'x-real-ip': '203.0.113.10',
      'x-forwarded-for': '203.0.113.11, 198.51.100.7',
    }))).toBeNull()
  })

  it('uses proxy headers when explicit trusted-proxy config is enabled', () => {
    process.env.TRUST_PROXY_HEADERS = 'true'

    expect(getRequestIp(new Headers({
      'x-real-ip': '203.0.113.10',
    }))).toBe('203.0.113.10')
  })

  it('uses forwarded IPs automatically on Vercel', () => {
    process.env.VERCEL = '1'

    expect(getRequestIp(new Headers({
      'x-forwarded-for': '203.0.113.10, 198.51.100.7',
    }))).toBe('203.0.113.10')
  })

  it('returns an empty string when no proxy headers are present', () => {
    expect(getRequestIp(new Headers())).toBeNull()
  })
})

describe('takeBestEffortRateLimitToken', () => {
  const originalVercel = process.env.VERCEL
  const originalVercelEnv = process.env.VERCEL_ENV
  const originalFallback = process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK
  const originalUpstashUrl = process.env.UPSTASH_REDIS_REST_URL
  const originalUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
  const originalKvUrl = process.env.KV_REST_API_URL
  const originalKvToken = process.env.KV_REST_API_TOKEN

  beforeEach(() => {
    resetRateLimitBucketsForTests()
    process.env.VERCEL = '1'
    delete process.env.VERCEL_ENV
    delete process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalVercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = originalVercel
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = originalVercelEnv
    if (originalFallback === undefined) delete process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK
    else process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = originalFallback
    if (originalUpstashUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL
    else process.env.UPSTASH_REDIS_REST_URL = originalUpstashUrl
    if (originalUpstashToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalUpstashToken
    if (originalKvUrl === undefined) delete process.env.KV_REST_API_URL
    else process.env.KV_REST_API_URL = originalKvUrl
    if (originalKvToken === undefined) delete process.env.KV_REST_API_TOKEN
    else process.env.KV_REST_API_TOKEN = originalKvToken
  })

  it('lets read-only routes opt into in-memory fallback when production Redis env is absent', async () => {
    const bestEffort = await takeBestEffortRateLimitToken('readonly-preflight', { max: 1, windowMs: 60_000 })
    const strict = await takeRateLimitToken('strict-write', { max: 1, windowMs: 60_000 })

    expect(bestEffort).toEqual({ limited: false, retryAfterSeconds: 60 })
    expect(strict).toEqual({ limited: true, retryAfterSeconds: 60 })
  })
})
