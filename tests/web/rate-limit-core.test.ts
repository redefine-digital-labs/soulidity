import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetRateLimitBucketsForTests,
  takeRateLimitTokenWithFallback,
} from '@web/lib/rate-limit-core'

describe('takeRateLimitTokenWithFallback', () => {
  beforeEach(() => {
    resetRateLimitBucketsForTests()
  })

  it('falls back to the in-memory limiter when the remote limiter throws', async () => {
    const takeRemoteToken = vi.fn().mockRejectedValue(new Error('upstash unavailable'))
    const onRemoteFallback = vi.fn()

    const first = await takeRateLimitTokenWithFallback({
      key: 'fallback-key',
      options: { max: 1, windowMs: 60_000 },
      takeRemoteToken,
      onRemoteFallback,
    })
    const second = await takeRateLimitTokenWithFallback({
      key: 'fallback-key',
      options: { max: 1, windowMs: 60_000 },
      takeRemoteToken,
      onRemoteFallback,
    })

    expect(first).toEqual({ limited: false, retryAfterSeconds: 60 })
    expect(second.limited).toBe(true)
    expect(second.retryAfterSeconds).toBeGreaterThan(0)
    expect(takeRemoteToken).toHaveBeenCalledTimes(2)
    expect(onRemoteFallback).toHaveBeenCalledTimes(2)
    expect(onRemoteFallback).toHaveBeenNthCalledWith(1, expect.objectContaining({
      reason: 'remote_error',
    }))
  })

  it('fails closed when remote limiting is unavailable and fallback is disabled', async () => {
    const onRemoteFallback = vi.fn()

    const result = await takeRateLimitTokenWithFallback({
      key: 'strict-key',
      options: { max: 10, windowMs: 30_000 },
      takeRemoteToken: null,
      allowInMemoryFallback: false,
      onRemoteFallback,
    })

    expect(result).toEqual({ limited: true, retryAfterSeconds: 30 })
    expect(onRemoteFallback).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'remote_unavailable',
    }))
  })
})
