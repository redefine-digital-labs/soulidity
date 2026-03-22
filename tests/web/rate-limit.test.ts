import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getRequestIp, resetRateLimitBucketsForTests } from '@web/lib/rate-limit'

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
