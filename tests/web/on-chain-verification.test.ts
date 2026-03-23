import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedSuiClient = vi.hoisted(() => ({
  getObject: vi.fn(),
  getTransactionBlock: vi.fn(),
}))

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
        type: '0xpackage::purchase::PricingPlan',
        content: {
          dataType: 'moveObject',
          type: '0xpackage::purchase::PricingPlan',
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

  it('rejects excessively nested optional addresses before recursive parsing can grow unbounded', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xpass',
        owner: { AddressOwner: `0x${'1'.repeat(64)}` },
        type: '0xpackage::pass::PerpetualPass',
        content: {
          dataType: 'moveObject',
          type: '0xpackage::pass::PerpetualPass',
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
})
