import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getRequestIp, resetRateLimitBucketsForTests } from '@web/lib/rate-limit'

describe('getRequestIp', () => {
  const originalVercel = process.env.VERCEL
  const originalVercelEnv = process.env.VERCEL_ENV

  beforeEach(() => {
    resetRateLimitBucketsForTests()
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
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
  })

  it('reads x-real-ip even when Vercel env vars are absent', () => {
    expect(getRequestIp(new Headers({
      'x-real-ip': '203.0.113.10',
    }))).toBe('203.0.113.10')
  })

  it('falls back to the first forwarded IP even when Vercel env vars are absent', () => {
    expect(getRequestIp(new Headers({
      'x-forwarded-for': '203.0.113.10, 198.51.100.7',
    }))).toBe('203.0.113.10')
  })

  it('returns an empty string when no proxy headers are present', () => {
    expect(getRequestIp(new Headers())).toBe('')
  })
})
