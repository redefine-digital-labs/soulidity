import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedSuiClient = vi.hoisted(() => ({
  getObject: vi.fn(),
  getTransactionBlock: vi.fn(),
}))
const PACKAGE_ID = `0x${'9'.repeat(64)}`
const COUNTERFEIT_PACKAGE_ID = `0x${'8'.repeat(64)}`

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

describe('on-chain verification helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('rejects bigint pass expiries that exceed Number.MAX_SAFE_INTEGER', async () => {
    const { dateFromSafeMsBigInt, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    expect(() =>
      dateFromSafeMsBigInt(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'Pass expires_at'),
    ).toThrow(OnChainVerificationError)
  })

  it('rejects unsafe numeric pricing plan fields before coercing them to bigint', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xplan',
        type: `${PACKAGE_ID}::purchase::PricingPlan`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::purchase::PricingPlan`,
          fields: {
            series_id: `0x${'1'.repeat(64)}`,
            plan_type: 0,
            price_usdc: Number.MAX_SAFE_INTEGER + 1,
            period_ms: 0,
            active: true,
          },
        },
      },
    })

    const { getVerifiedPricingPlanState, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedPricingPlanState('0xplan')).rejects.toThrow(OnChainVerificationError)
  })

  it('rejects excessively large decimal strings before coercing them to bigint', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xplan',
        type: `${PACKAGE_ID}::purchase::PricingPlan`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::purchase::PricingPlan`,
          fields: {
            series_id: `0x${'1'.repeat(64)}`,
            plan_type: 0,
            price_usdc: '9'.repeat(79),
            period_ms: 0,
            active: true,
          },
        },
      },
    })

    const { getVerifiedPricingPlanState, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedPricingPlanState('0xplan')).rejects.toThrow(OnChainVerificationError)
  })

  it('rejects malformed decimal strings before calling BigInt()', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xplan',
        type: `${PACKAGE_ID}::purchase::PricingPlan`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::purchase::PricingPlan`,
          fields: {
            series_id: `0x${'1'.repeat(64)}`,
            plan_type: 0,
            price_usdc: '123abc',
            period_ms: 0,
            active: true,
          },
        },
      },
    })

    const { getVerifiedPricingPlanState, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedPricingPlanState('0xplan')).rejects.toThrow(OnChainVerificationError)
  })

  it('rejects excessively nested optional addresses before recursive parsing can grow unbounded', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xpass',
        owner: { AddressOwner: `0x${'1'.repeat(64)}` },
        type: `${PACKAGE_ID}::pass::PerpetualPass`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          fields: {
            owner: `0x${'1'.repeat(64)}`,
            series_id: `0x${'2'.repeat(64)}`,
            release_id: `0x${'3'.repeat(64)}`,
            agent_grant: {
              vec: [{
                vec: [{
                  vec: [{
                    vec: [{
                      vec: [`0x${'4'.repeat(64)}`],
                    }],
                  }],
                }],
              }],
            },
          },
        },
      },
    })

    const { getVerifiedPassState, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedPassState('0xpass')).rejects.toThrow(OnChainVerificationError)
  })

  it('normalizes agent grant addresses before returning verified pass state', async () => {
    const canonicalAgentGrant = `0x${'ab'.repeat(32)}`
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xpass',
        owner: { AddressOwner: `0x${'1'.repeat(64)}` },
        type: `${PACKAGE_ID}::pass::PerpetualPass`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          fields: {
            owner: `0x${'1'.repeat(64)}`,
            series_id: `0x${'2'.repeat(64)}`,
            release_id: `0x${'3'.repeat(64)}`,
            agent_grant: { vec: [canonicalAgentGrant.toUpperCase()] },
          },
        },
      },
    })

    const { getVerifiedPassState } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedPassState('0xpass', PACKAGE_ID)).resolves.toMatchObject({
      objectId: '0xpass',
      agentGrant: canonicalAgentGrant,
    })
  })

  it('rejects malformed agent grant addresses instead of passing raw strings through', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xpass',
        owner: { AddressOwner: `0x${'1'.repeat(64)}` },
        type: `${PACKAGE_ID}::pass::PerpetualPass`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          fields: {
            owner: `0x${'1'.repeat(64)}`,
            series_id: `0x${'2'.repeat(64)}`,
            release_id: `0x${'3'.repeat(64)}`,
            agent_grant: { vec: ['not-an-address'] },
          },
        },
      },
    })

    const { getVerifiedPassState, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedPassState('0xpass', PACKAGE_ID)).rejects.toThrow(OnChainVerificationError)
  })

  it('rejects pass objects from a counterfeit package when a package id is expected', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xpass',
        owner: { AddressOwner: `0x${'1'.repeat(64)}` },
        type: `${COUNTERFEIT_PACKAGE_ID}::pass::PerpetualPass`,
        content: {
          dataType: 'moveObject',
          type: `${COUNTERFEIT_PACKAGE_ID}::pass::PerpetualPass`,
          fields: {
            owner: `0x${'1'.repeat(64)}`,
            series_id: `0x${'2'.repeat(64)}`,
            release_id: `0x${'3'.repeat(64)}`,
            agent_grant: { vec: [] },
          },
        },
      },
    })

    const { getVerifiedPassState, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedPassState('0xpass', PACKAGE_ID)).rejects.toThrow(OnChainVerificationError)
  })

  it('rejects series objects with malformed required fields', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xseries',
        type: `${PACKAGE_ID}::series::SoulSeries`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::series::SoulSeries`,
          fields: {
            name: 'Soul',
            description: 'Desc',
            category: 'Research',
            tags: [],
            preview_images: [],
            author: 123,
          },
        },
      },
    })

    const { getVerifiedSeriesState, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedSeriesState('0xseries', PACKAGE_ID)).rejects.toThrow(OnChainVerificationError)
  })

  it('reads the chain latest release id from Soul series objects', async () => {
    const latestReleaseId = `0x${'3'.repeat(64)}`
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xseries',
        type: `${PACKAGE_ID}::series::SoulSeries`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::series::SoulSeries`,
          fields: {
            name: 'Soul',
            description: 'Desc',
            category: 'Research',
            tags: [],
            preview_images: [],
            author: `0x${'1'.repeat(64)}`,
            latest_release_id: { vec: [latestReleaseId] },
          },
        },
      },
    })

    const { getVerifiedSeriesState } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedSeriesState('0xseries', PACKAGE_ID)).resolves.toMatchObject({
      objectId: '0xseries',
      latestReleaseId,
    })
  })

  it('rejects malformed chain latest release ids instead of silently dropping them', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xseries',
        type: `${PACKAGE_ID}::series::SoulSeries`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::series::SoulSeries`,
          fields: {
            name: 'Soul',
            description: 'Desc',
            category: 'Research',
            tags: [],
            preview_images: [],
            author: `0x${'1'.repeat(64)}`,
            latest_release_id: { vec: [123] },
          },
        },
      },
    })

    const { getVerifiedSeriesState, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedSeriesState('0xseries', PACKAGE_ID)).rejects.toThrow(OnChainVerificationError)
  })

  it('rejects release objects from the wrong package', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xrelease',
        type: `${COUNTERFEIT_PACKAGE_ID}::series::SoulRelease`,
        content: {
          dataType: 'moveObject',
          type: `${COUNTERFEIT_PACKAGE_ID}::series::SoulRelease`,
          fields: {
            series_id: `0x${'1'.repeat(64)}`,
            version: '1.0.0',
            encrypted_blob_id: 'blob-1',
            public_metadata_id: null,
            content_hash: [0xde, 0xad],
          },
        },
      },
    })

    const { getVerifiedReleaseState, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedReleaseState('0xrelease', PACKAGE_ID)).rejects.toThrow(OnChainVerificationError)
  })

  it('throws when a transaction effect status is not success', async () => {
    const { ensureTransactionSucceeded, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    expect(() => ensureTransactionSucceeded({
      effects: {
        status: {
          status: 'failure',
        },
      },
    } as any)).toThrow(OnChainVerificationError)
  })

  describe('getVerifiedSoulRenewIntents', () => {
    const PLAN_ID = `0x${'a'.repeat(64)}`
    const SERIES_ID = `0x${'b'.repeat(64)}`
    const PASS_ID = `0x${'c'.repeat(64)}`
    const PLATFORM_CONFIG_ID = `0x${'d'.repeat(64)}`
    const PAYMENT_COIN_ID = `0x${'e'.repeat(64)}`
    const CLOCK_ID = '0x0000000000000000000000000000000000000000000000000000000000000006'

    function buildRenewTx(overrides?: {
      module?: string
      function?: string
      packageId?: string
      arguments?: unknown
    }) {
      return {
        transaction: {
          data: {
            transaction: {
              kind: 'ProgrammableTransaction',
              inputs: [
                { type: 'object', objectId: PLATFORM_CONFIG_ID, objectType: 'sharedObject', initialSharedVersion: 1, mutable: false },
                { type: 'object', objectId: PLAN_ID, objectType: 'sharedObject', initialSharedVersion: 1, mutable: false },
                { type: 'object', objectId: SERIES_ID, objectType: 'sharedObject', initialSharedVersion: 1, mutable: false },
                { type: 'object', objectId: PASS_ID, objectType: 'immOrOwnedObject', version: '1', digest: 'abc' },
                { type: 'object', objectId: PAYMENT_COIN_ID, objectType: 'immOrOwnedObject', version: '1', digest: 'def' },
                { type: 'object', objectId: CLOCK_ID, objectType: 'sharedObject', initialSharedVersion: 1, mutable: false },
              ],
              transactions: [{
                MoveCall: {
                  package: overrides?.packageId ?? PACKAGE_ID,
                  module: overrides?.module ?? 'purchase',
                  function: overrides?.function ?? 'renew_subscription',
                  arguments: overrides && 'arguments' in overrides
                    ? overrides.arguments
                    : [
                        { Input: 0 },
                        { Input: 1 },
                        { Input: 2 },
                        { Input: 3 },
                        { Input: 4 },
                        { Input: 5 },
                      ],
                },
              }],
            },
          },
        },
      }
    }

    it('parses a renew_subscription move call and returns planId, seriesId and passId', async () => {
      const { getVerifiedSoulRenewIntents } = await import('../../web/lib/souls/on-chain-verification.ts')

      const result = getVerifiedSoulRenewIntents(buildRenewTx() as any)

      expect(result).toEqual([{ planId: PLAN_ID, seriesId: SERIES_ID, passId: PASS_ID }])
    })

    it('ignores buy_subscription move calls and returns an empty array', async () => {
      const { getVerifiedSoulRenewIntents } = await import('../../web/lib/souls/on-chain-verification.ts')

      const result = getVerifiedSoulRenewIntents(buildRenewTx({ function: 'buy_subscription' }) as any)

      expect(result).toEqual([])
    })

    it('ignores move calls from a non-purchase module', async () => {
      const { getVerifiedSoulRenewIntents } = await import('../../web/lib/souls/on-chain-verification.ts')

      const result = getVerifiedSoulRenewIntents(buildRenewTx({ module: 'grant' }) as any)

      expect(result).toEqual([])
    })

    it('ignores move calls from a mismatched package when expectedPackageId is provided', async () => {
      const { getVerifiedSoulRenewIntents } = await import('../../web/lib/souls/on-chain-verification.ts')

      const result = getVerifiedSoulRenewIntents(
        buildRenewTx({ packageId: COUNTERFEIT_PACKAGE_ID }) as any,
        PACKAGE_ID,
      )

      expect(result).toEqual([])
    })

    it('throws with status 503 when the move call arguments list is null', async () => {
      const { getVerifiedSoulRenewIntents, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

      expect(() => getVerifiedSoulRenewIntents(buildRenewTx({ arguments: null }) as any)).toThrow(OnChainVerificationError)
      expect(() => getVerifiedSoulRenewIntents(buildRenewTx({ arguments: null }) as any)).toThrow('unavailable for verification')
    })
  })
})
