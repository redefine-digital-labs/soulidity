import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getCachedMarketConfig,
  resetMarketConfigCacheForTests,
} from '../../web/lib/soulidity/market-config-cache'

describe('market config cache', () => {
  beforeEach(() => {
    resetMarketConfigCacheForTests()
  })

  it('reuses the cached config within the ttl window', async () => {
    const loader = vi.fn(async () => ({
      objectId: '0xconfig',
      packageId: '0xpackage',
      feeRecipient: '0xfee',
      platformFeeBps: 250,
      paused: false,
    }))

    const first = await getCachedMarketConfig('0xconfig', '0xpackage', loader)
    const second = await getCachedMarketConfig('0xconfig', '0xpackage', loader)

    expect(first).toEqual(second)
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
