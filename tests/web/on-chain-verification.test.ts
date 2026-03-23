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
})
