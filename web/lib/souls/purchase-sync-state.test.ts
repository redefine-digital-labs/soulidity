import { describe, expect, it } from 'vitest'
import {
  buildPurchaseOwnershipConflictBody,
  buildPurchaseOwnershipChangedBody,
  purchaseSyncBodiesEqual,
  readRecoverableStoredPurchaseSync,
} from '@web/lib/souls/purchase-sync-state'

describe('purchase sync state helpers', () => {
  it('reads recoverable stored purchase sync with validated ids', () => {
    expect(
      readRecoverableStoredPurchaseSync({
        statusCode: 207,
        body: {
          digest: '7m2Wv7eoeh6wHk5GgZ3PnqTBRPjRc1n7v5Qh3h9F2abc',
          onChainSuccess: true,
          dbSynced: false,
          currentOwnerAddress: '0x2',
          currentKioskId: '0x3',
          currentKioskCapOnChainId: '0x4',
          txSender: '0x5',
        },
      }),
    ).toEqual({
      digest: '7m2Wv7eoeh6wHk5GgZ3PnqTBRPjRc1n7v5Qh3h9F2abc',
      currentOwnerAddress: '0x0000000000000000000000000000000000000000000000000000000000000002',
      currentKioskId: '0x0000000000000000000000000000000000000000000000000000000000000003',
      currentKioskCapOnChainId: '0x0000000000000000000000000000000000000000000000000000000000000004',
      txSender: '0x0000000000000000000000000000000000000000000000000000000000000005',
    })
  })

  it('rejects recoverable sync bodies with invalid stored ids', () => {
    expect(
      readRecoverableStoredPurchaseSync({
        statusCode: 207,
        body: {
          digest: '7m2Wv7eoeh6wHk5GgZ3PnqTBRPjRc1n7v5Qh3h9F2abc',
          onChainSuccess: true,
          dbSynced: false,
          currentOwnerAddress: 'invalid',
          currentKioskId: '0x3',
          currentKioskCapOnChainId: '0x4',
        },
      }),
    ).toBeNull()
  })

  it('marks ownership-conflict responses as non-retryable', () => {
    expect(buildPurchaseOwnershipConflictBody({
      digest: 'digest-1',
      soulOnChainId: '0x2',
      currentOwnerAddress: '0x3',
      currentKioskId: '0x4',
      currentKioskCapOnChainId: '0x5',
      ownerLabel: 'buyer',
    })).toEqual({
      digest: 'digest-1',
      soulOnChainId: '0x2',
      currentOwnerAddress: '0x3',
      currentKioskId: '0x4',
      currentKioskCapOnChainId: '0x5',
      listingStatus: 'held',
      onChainSuccess: true,
      dbSynced: false,
      ownershipConflict: true,
      error: 'Transaction succeeded on chain, but the local Soul mirror no longer matched the expected buyer ownership. Refresh the Soul detail instead of retrying.',
    })
  })

  it('marks ownership-changed responses as terminal refresh signals', () => {
    expect(buildPurchaseOwnershipChangedBody({
      digest: 'digest-2',
      soulOnChainId: '0x9',
    })).toEqual({
      digest: 'digest-2',
      soulOnChainId: '0x9',
      onChainSuccess: true,
      dbSynced: false,
      ownershipChanged: true,
      error: 'Soul ownership changed since the original purchase sync. Refresh the Soul detail instead of retrying.',
    })
  })

  it('compares pending purchase sync payloads structurally', () => {
    expect(purchaseSyncBodiesEqual(
      { digest: '1', error: 'pending' },
      { digest: '1', error: 'pending' },
    )).toBe(true)
    expect(purchaseSyncBodiesEqual(
      { digest: '1', error: 'pending' },
      { digest: '1', error: 'changed' },
    )).toBe(false)
  })
})
