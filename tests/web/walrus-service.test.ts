import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Walrus blob validation', () => {
  const originalEnv = { ...process.env }
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.NEXT_PUBLIC_SUI_NETWORK
    delete process.env.WALRUS_AGGREGATOR_URL
    delete process.env.WALRUS_PUBLISHER_URL
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...originalEnv }
    global.fetch = originalFetch
  })

  it('accepts bare blob ids and aggregator URLs', async () => {
    const { normalizeWalrusBlobId } = await import('../../web/lib/services/walrus.ts')

    expect(normalizeWalrusBlobId('blob-123')).toBe('blob-123')
    expect(
      normalizeWalrusBlobId('https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob-123'),
    ).toBe('blob-123')
  })

  it('rejects malformed blob ids', async () => {
    const { normalizeWalrusBlobId } = await import('../../web/lib/services/walrus.ts')

    expect(normalizeWalrusBlobId('../escape')).toBeNull()
    expect(normalizeWalrusBlobId('https://example.com/v1/blobs/blob-123')).toBeNull()
    expect(normalizeWalrusBlobId('blob-123?evil=1')).toBeNull()
  })

  it('materializes safe Walrus URLs only', async () => {
    const { materializeWalrusBlobUrls } = await import('../../web/lib/services/walrus.ts')

    expect(
      materializeWalrusBlobUrls([
        'blob-123',
        'https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob-456',
        'https://tracker.example/pixel.png',
      ]),
    ).toEqual([
      'https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob-123',
      'https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob-456',
    ])
  })

  it('URL-encodes validated blob ids when building download URLs', async () => {
    const { getBlobUrl } = await import('../../web/lib/services/walrus.ts')

    expect(getBlobUrl('blob_id-123')).toBe(
      'https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob_id-123',
    )
  })

  it('switches the default aggregator to mainnet when the Sui network is mainnet', async () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'

    const { getBlobUrl } = await import('../../web/lib/services/walrus.ts')

    expect(getBlobUrl('blob-123')).toBe(
      'https://aggregator.mainnet.walrus.mirai.cloud/v1/blobs/blob-123',
    )
  })

  it('recomputes runtime config on each call during development', async () => {
    process.env.NODE_ENV = 'development'
    process.env.WALRUS_AGGREGATOR_URL = 'https://aggregator.dev-1.example'

    const { getWalrusRuntimeConfig } = await import('../../web/lib/services/walrus.ts')

    expect(getWalrusRuntimeConfig().aggregatorUrl).toBe('https://aggregator.dev-1.example')

    process.env.WALRUS_AGGREGATOR_URL = 'https://aggregator.dev-2.example'
    expect(getWalrusRuntimeConfig().aggregatorUrl).toBe('https://aggregator.dev-2.example')
  })

  it('caps upload retries instead of walking every testnet publisher twice', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('publisher down')
    }) as typeof fetch

    const { uploadPublic } = await import('../../web/lib/services/walrus.ts')

    await expect(uploadPublic(Buffer.from('payload'))).rejects.toThrow('publisher down')
    expect(global.fetch).toHaveBeenCalledTimes(4)
  })

  it('samples a capped subset of configured testnet publishers within the retry budget', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi.fn(async () => {
      throw new Error('publisher down')
    })
    global.fetch = fetchMock as typeof fetch

    const { getWalrusRuntimeConfig, uploadPublic } = await import('../../web/lib/services/walrus.ts')
    const knownPublisherBlobUrls = new Set(
      getWalrusRuntimeConfig().publisherUrls.map((url) => `${url}/v1/blobs`),
    )

    await expect(uploadPublic(Buffer.from('payload'))).rejects.toThrow('publisher down')
    const attemptedUrls = fetchMock.mock.calls.map(([url]) => url as string)
    expect(attemptedUrls).toHaveLength(4)
    expect(new Set(attemptedUrls).size).toBe(4)
    attemptedUrls.forEach((url) => {
      expect(knownPublisherBlobUrls.has(url)).toBe(true)
    })

    randomSpy.mockRestore()
  })

  it('does not retry non-retryable 4xx upload failures', async () => {
    global.fetch = vi.fn(async () => new Response('payload too large', { status: 413 })) as typeof fetch

    const { uploadPublic } = await import('../../web/lib/services/walrus.ts')

    await expect(uploadPublic(Buffer.from('payload'))).rejects.toThrow(
      'Walrus upload failed: 413 payload too large',
    )
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('retries 429 upload failures and succeeds on a later publisher', async () => {
    let attempts = 0
    global.fetch = vi.fn(async () => {
      attempts += 1
      if (attempts < 3) {
        return new Response('slow down', {
          status: 429,
          headers: { 'Retry-After': '0' },
        })
      }

      return new Response(
        JSON.stringify({
          newlyCreated: {
            blobObject: {
              blobId: 'blob-123',
              id: 'walrus-object-1',
            },
          },
        }),
      )
    }) as typeof fetch

    const { uploadPublic } = await import('../../web/lib/services/walrus.ts')

    await expect(uploadPublic(Buffer.from('payload'))).resolves.toEqual({
      blobId: 'blob-123',
      blobObjectId: 'walrus-object-1',
    })
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it('waits for retry-after before retrying 429 responses', async () => {
    vi.useFakeTimers()
    let attempts = 0
    global.fetch = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response('slow down', {
          status: 429,
          headers: { 'Retry-After': '1' },
        })
      }

      return new Response(
        JSON.stringify({
          newlyCreated: {
            blobObject: {
              blobId: 'blob-123',
              id: 'walrus-object-1',
            },
          },
        }),
      )
    }) as typeof fetch

    const { uploadPublic } = await import('../../web/lib/services/walrus.ts')

    const uploadPromise = uploadPublic(Buffer.from('payload'))
    expect(global.fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(999)
    expect(global.fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect(uploadPromise).resolves.toEqual({
      blobId: 'blob-123',
      blobObjectId: 'walrus-object-1',
    })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('caps 429 retry delays to ten seconds per attempt', async () => {
    vi.useFakeTimers()
    let attempts = 0
    global.fetch = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response('slow down', {
          status: 429,
          headers: { 'Retry-After': '999999' },
        })
      }

      return new Response(
        JSON.stringify({
          newlyCreated: {
            blobObject: {
              blobId: 'blob-123',
              id: 'walrus-object-1',
            },
          },
        }),
      )
    }) as typeof fetch

    const { uploadPublic } = await import('../../web/lib/services/walrus.ts')

    const uploadPromise = uploadPublic(Buffer.from('payload'))
    expect(global.fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(9_999)
    expect(global.fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect(uploadPromise).resolves.toEqual({
      blobId: 'blob-123',
      blobObjectId: 'walrus-object-1',
    })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('uses a minimal backoff for past Retry-After HTTP-date values', async () => {
    vi.useFakeTimers()
    let attempts = 0
    global.fetch = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response('slow down', {
          status: 429,
          headers: { 'Retry-After': 'Wed, 21 Oct 2015 07:28:00 GMT' },
        })
      }

      return new Response(
        JSON.stringify({
          newlyCreated: {
            blobObject: {
              blobId: 'blob-123',
              id: 'walrus-object-1',
            },
          },
        }),
      )
    }) as typeof fetch

    const { uploadPublic } = await import('../../web/lib/services/walrus.ts')

    const uploadPromise = uploadPublic(Buffer.from('payload'))
    expect(global.fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(499)
    expect(global.fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect(uploadPromise).resolves.toEqual({
      blobId: 'blob-123',
      blobObjectId: 'walrus-object-1',
    })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('waits a minimal backoff before retrying 5xx responses', async () => {
    vi.useFakeTimers()
    let attempts = 0
    global.fetch = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) {
        return new Response('server error', { status: 503 })
      }

      return new Response(
        JSON.stringify({
          newlyCreated: {
            blobObject: {
              blobId: 'blob-123',
              id: 'walrus-object-1',
            },
          },
        }),
      )
    }) as typeof fetch

    const { uploadPublic } = await import('../../web/lib/services/walrus.ts')

    const uploadPromise = uploadPublic(Buffer.from('payload'))
    expect(global.fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(499)
    expect(global.fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect(uploadPromise).resolves.toEqual({
      blobId: 'blob-123',
      blobObjectId: 'walrus-object-1',
    })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})
