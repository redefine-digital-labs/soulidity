import { describe, expect, it, vi } from 'vitest'

import { MirrorSyncError, mirrorRouteRequest } from '../../web/lib/souls/mirror-sync.ts'

describe('mirrorRouteRequest', () => {
  it('retries transient failures before succeeding', async () => {
    const response = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true }),
    }
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(response)

    const result = await mirrorRouteRequest({
      fetchImpl,
      input: '/api/souls/0xseries/purchase',
      init: { method: 'POST' },
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ ok: true })
  })

  it('throws a mirror sync error with server context for non-retryable failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: vi.fn().mockResolvedValue({ error: 'On-chain allowlist state does not match the requested agent' }),
    })

    await expect(() =>
      mirrorRouteRequest({
        fetchImpl,
        input: '/api/souls/0xsoul/allowlist',
        init: { method: 'POST' },
      }),
    ).rejects.toMatchObject<Partial<MirrorSyncError>>({
      name: 'MirrorSyncError',
      status: 422,
      retryable: false,
      chainSucceeded: true,
    })
  })

  it('surfaces plain-text server errors without double-consuming the response body', async () => {
    let bodyUsed = false
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockImplementation(async () => {
        bodyUsed = true
        throw new Error('Unexpected token')
      }),
      text: vi.fn().mockImplementation(async () => {
        if (bodyUsed) {
          throw new TypeError('body used already')
        }
        bodyUsed = true
        return 'Plain-text upstream error'
      }),
    })

    await expect(() =>
      mirrorRouteRequest({
        fetchImpl,
        input: '/api/souls/0xsoul/allowlist',
        init: { method: 'POST' },
        maxAttempts: 1,
      }),
    ).rejects.toMatchObject<Partial<MirrorSyncError>>({
      message: 'Plain-text upstream error',
      status: 500,
      retryable: true,
    })
  })
})
