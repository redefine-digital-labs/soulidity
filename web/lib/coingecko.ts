type CoingeckoAssetId = 'sui'

const PRICE_CACHE_TTL_MS = 60_000

type CachedPrice = {
  usd: number
  expiresAt: number
}

const globalForCoingecko = globalThis as typeof globalThis & {
  coingeckoUsdPriceCache?: Map<CoingeckoAssetId, CachedPrice>
  coingeckoUsdPriceRequests?: Map<CoingeckoAssetId, Promise<number>>
}

const usdPriceCache = globalForCoingecko.coingeckoUsdPriceCache ?? new Map<CoingeckoAssetId, CachedPrice>()
const pendingPriceRequests =
  globalForCoingecko.coingeckoUsdPriceRequests ?? new Map<CoingeckoAssetId, Promise<number>>()

if (process.env.NODE_ENV !== 'production') {
  globalForCoingecko.coingeckoUsdPriceCache = usdPriceCache
  globalForCoingecko.coingeckoUsdPriceRequests = pendingPriceRequests
}

export async function getCoingeckoUsdPrice(id: CoingeckoAssetId): Promise<number> {
  const now = Date.now()
  const cached = usdPriceCache.get(id)
  if (cached && cached.expiresAt > now) {
    return cached.usd
  }

  const pending = pendingPriceRequests.get(id)
  if (pending) {
    return pending
  }

  const request = (async () => {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
      { cache: 'no-store' },
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch ${id} price`)
    }

    const payload = await response.json() as Record<string, { usd?: number }>
    const usdPrice = payload[id]?.usd
    if (!usdPrice) {
      throw new Error(`Missing ${id} USD price`)
    }

    usdPriceCache.set(id, {
      usd: usdPrice,
      expiresAt: Date.now() + PRICE_CACHE_TTL_MS,
    })

    return usdPrice
  })().finally(() => {
    pendingPriceRequests.delete(id)
  })

  pendingPriceRequests.set(id, request)
  return request
}

export function resetCoingeckoUsdPriceCache(): void {
  usdPriceCache.clear()
  pendingPriceRequests.clear()
}
