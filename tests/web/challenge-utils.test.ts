import { describe, expect, it } from 'vitest'

import { getWalletChallengeCleanupCutoff } from '../../web/lib/auth/challenge.ts'

describe('wallet challenge cleanup cutoff', () => {
  it('keeps at most fifteen minutes of stale challenges beyond the 5 minute TTL', () => {
    const now = Date.UTC(2026, 2, 22, 12, 0, 0)
    const cutoff = getWalletChallengeCleanupCutoff(now)

    expect(now - cutoff.getTime()).toBe(15 * 60 * 1000)
  })
})
