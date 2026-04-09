import type { SoulidityMarketConfig } from '@/lib/soulidity/types'
import { getMarketConfig } from '@/lib/soulidity/queries'

const MARKET_CONFIG_CACHE_TTL_MS = 60_000

type MarketConfigCacheEntry = {
  expiresAt: number
  value: SoulidityMarketConfig
}

const marketConfigCache = new Map<string, MarketConfigCacheEntry>()
const inflightLoads = new Map<string, Promise<SoulidityMarketConfig>>()

function buildCacheKey(configId: string, packageId: string) {
  return `${configId}:${packageId}`
}

export async function getCachedMarketConfig(
  configId: string,
  packageId: string,
  loader: (configId: string, packageId: string) => Promise<SoulidityMarketConfig> = getMarketConfig,
): Promise<SoulidityMarketConfig> {
  const key = buildCacheKey(configId, packageId)
  const now = Date.now()
  const cached = marketConfigCache.get(key)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }

  const inflight = inflightLoads.get(key)
  if (inflight) {
    return inflight
  }

  const nextLoad = loader(configId, packageId)
    .then((value) => {
      marketConfigCache.set(key, {
        value,
        expiresAt: Date.now() + MARKET_CONFIG_CACHE_TTL_MS,
      })
      return value
    })
    .finally(() => {
      inflightLoads.delete(key)
    })

  inflightLoads.set(key, nextLoad)
  return nextLoad
}

export function resetMarketConfigCacheForTests() {
  marketConfigCache.clear()
  inflightLoads.clear()
}
