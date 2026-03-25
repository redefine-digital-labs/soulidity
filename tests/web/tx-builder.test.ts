import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }
const PACKAGE_ID = '0xsoul'

describe('tx builders', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_SOUL_PACKAGE_ID: PACKAGE_ID,
    }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('rejects create-series payloads that exceed the on-chain tag limit', async () => {
    const { buildCreateSeriesTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildCreateSeriesTx({
      name: 'Soul name',
      description: 'Soul description',
      category: 'Research',
      tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`),
      previewImages: [],
    })).toThrow('Soul tags exceed the 10-tag limit')
  })

  it('rejects preview image references that exceed the on-chain byte limit', async () => {
    const { buildCreateSeriesTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildCreateSeriesTx({
      name: 'Soul name',
      description: 'Soul description',
      category: 'Research',
      tags: ['alpha'],
      previewImages: ['x'.repeat(513)],
    })).toThrow('Soul preview image reference exceeds the 512-byte limit')
  })

  it('rejects publish-release payloads whose contentHash is not 32 bytes', async () => {
    const { buildPublishReleaseTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildPublishReleaseTx({
      authorCapId: '0xcap',
      seriesId: '0xseries',
      version: '1.0.0',
      encryptedBlobId: 'blob-1',
      publicMetadataId: 'meta-1',
      contentHash: new Uint8Array(31),
    })).toThrow('contentHash must be 32 bytes')
  })

  it('rejects negative pricing plan values before they reach tx.pure.u64()', async () => {
    const { buildCreatePricingPlanTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildCreatePricingPlanTx({
      authorCapId: '0xcap',
      seriesId: '0xseries',
      planType: 0,
      priceUsdc: -1n,
      periodMs: 0n,
    })).toThrow('priceUsdc must be non-negative')

    expect(() => buildCreatePricingPlanTx({
      authorCapId: '0xcap',
      seriesId: '0xseries',
      planType: 1,
      priceUsdc: 1_000_000n,
      periodMs: -1n,
    })).toThrow('periodMs must be non-negative')
  })

  it('builds the perpetual purchase move call against the configured package and release', async () => {
    const { Transaction } = await import('../../web/node_modules/@mysten/sui/dist/transactions/index.mjs')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    const { buildBuyPerpetualTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildBuyPerpetualTx({
      platformConfigId: '0xplatform',
      planId: '0xplan',
      seriesId: '0xseries',
      releaseId: '0xrelease',
      paymentCoinIds: ['0xcoin'],
      amount: 1_000_000n,
    })
    const moveCall = moveCallSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined

    expect(moveCall).toMatchObject({
      target: `${PACKAGE_ID}::purchase::buy_perpetual`,
    })
    expect(Array.isArray(moveCall?.arguments) ? moveCall.arguments : []).toHaveLength(5)
    moveCallSpy.mockRestore()
  })

  it('builds the subscription purchase move call against the configured package and clock object', async () => {
    const { Transaction } = await import('../../web/node_modules/@mysten/sui/dist/transactions/index.mjs')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    const { buildBuySubscriptionTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildBuySubscriptionTx({
      platformConfigId: '0xplatform',
      planId: '0xplan',
      seriesId: '0xseries',
      paymentCoinIds: ['0xcoin'],
      amount: 1_000_000n,
    })
    const moveCall = moveCallSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined

    expect(moveCall).toMatchObject({
      target: `${PACKAGE_ID}::purchase::buy_subscription`,
    })
    expect(Array.isArray(moveCall?.arguments) ? moveCall.arguments : []).toHaveLength(5)
    moveCallSpy.mockRestore()
  })

  describe('buildRenewSubscriptionTx', () => {
    it('returns a Transaction object for valid params', async () => {
      const { buildRenewSubscriptionTx } = await import('../../web/lib/souls/tx-builder.ts')

      const result = buildRenewSubscriptionTx({
        platformConfigId: '0xplatform',
        planId: '0xplan',
        seriesId: '0xseries',
        passId: '0xpass',
        paymentCoinIds: ['0xcoin'],
        amount: 1_000_000n,
      })

      expect(result).toBeTruthy()
    })

    it('throws when paymentCoinIds is empty', async () => {
      const { buildRenewSubscriptionTx } = await import('../../web/lib/souls/tx-builder.ts')

      expect(() => buildRenewSubscriptionTx({
        platformConfigId: '0xplatform',
        planId: '0xplan',
        seriesId: '0xseries',
        passId: '0xpass',
        paymentCoinIds: [],
        amount: 1_000_000n,
      })).toThrow('paymentCoinIds is required')
    })
  })
})
