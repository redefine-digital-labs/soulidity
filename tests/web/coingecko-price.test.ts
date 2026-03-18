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
        json: vi.fn().mockResolvedValue({ solana: { usd: 125 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ solana: { usd: 126 } }),
      })

    vi.stubGlobal('fetch', fetchMock)

    await expect(getCoingeckoUsdPrice('solana')).resolves.toBe(125)
    await expect(getCoingeckoUsdPrice('solana')).resolves.toBe(125)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_001)

    await expect(getCoingeckoUsdPrice('solana')).resolves.toBe(126)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
