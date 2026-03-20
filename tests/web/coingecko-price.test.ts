import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getCoingeckoUsdPrice, resetCoingeckoUsdPriceCache } from '../../web/lib/coingecko.ts'

describe('CoinGecko price cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-17T00:00:00.000Z'))
  })

  afterEach(() => {
    resetCoingeckoUsdPriceCache()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('caches the same asset quote for 60 seconds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ sui: { usd: 125 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ sui: { usd: 126 } }),
      })

    vi.stubGlobal('fetch', fetchMock)

    await expect(getCoingeckoUsdPrice('sui')).resolves.toBe(125)
    await expect(getCoingeckoUsdPrice('sui')).resolves.toBe(125)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_001)

    await expect(getCoingeckoUsdPrice('sui')).resolves.toBe(126)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws when fetch returns ok: false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false }),
    )

    await expect(getCoingeckoUsdPrice('sui')).rejects.toThrow('Failed to fetch sui price')
  })

  it('throws when response JSON has no usd key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ sui: {} }),
      }),
    )

    await expect(getCoingeckoUsdPrice('sui')).rejects.toThrow('Missing sui USD price')
  })

  it('deduplicates concurrent requests for the same asset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ sui: { usd: 130 } }),
    })

    vi.stubGlobal('fetch', fetchMock)

    const [price1, price2] = await Promise.all([
      getCoingeckoUsdPrice('sui'),
      getCoingeckoUsdPrice('sui'),
    ])

    expect(price1).toBe(130)
    expect(price2).toBe(130)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
