import { afterEach, describe, expect, it } from 'vitest'

import {
  getSuiWalletSyncCacheEntry,
  getSuiWalletSyncCacheSize,
  resetSuiWalletSyncCacheForTests,
  setSuiWalletSyncCacheEntry,
  SUI_WALLET_SYNC_MAX_ENTRIES,
  SUI_WALLET_SYNC_TTL_MS,
} from '../../web/lib/auth/sui-wallet-sync-cache.ts'

describe('sui wallet sync cache', () => {
  afterEach(() => {
    resetSuiWalletSyncCacheForTests()
  })

  it('prunes stale non-inflight entries before they can accumulate', () => {
    const now = 1_000_000

    setSuiWalletSyncCacheEntry('member-stale', {
      inFlight: null,
      lastAttemptAt: now - SUI_WALLET_SYNC_TTL_MS - 1,
    }, now)
    setSuiWalletSyncCacheEntry('member-fresh', {
      inFlight: null,
      lastAttemptAt: now,
    }, now)

    expect(getSuiWalletSyncCacheEntry('member-stale', now)).toBeUndefined()
    expect(getSuiWalletSyncCacheEntry('member-fresh', now)).toEqual({
      inFlight: null,
      lastAttemptAt: now,
    })
    expect(getSuiWalletSyncCacheSize(now)).toBe(1)
  })

  it('evicts the oldest non-inflight entries when the cache exceeds its cap', () => {
    const now = 2_000_000

    for (let index = 0; index <= SUI_WALLET_SYNC_MAX_ENTRIES; index += 1) {
      setSuiWalletSyncCacheEntry(`member-${index}`, {
        inFlight: null,
        lastAttemptAt: now + index,
      }, now + index)
    }

    expect(getSuiWalletSyncCacheSize(now + SUI_WALLET_SYNC_MAX_ENTRIES)).toBe(SUI_WALLET_SYNC_MAX_ENTRIES)
    expect(getSuiWalletSyncCacheEntry('member-0', now + SUI_WALLET_SYNC_MAX_ENTRIES)).toBeUndefined()
    expect(getSuiWalletSyncCacheEntry(`member-${SUI_WALLET_SYNC_MAX_ENTRIES}`, now + SUI_WALLET_SYNC_MAX_ENTRIES)).toEqual({
      inFlight: null,
      lastAttemptAt: now + SUI_WALLET_SYNC_MAX_ENTRIES,
    })
  })
})
