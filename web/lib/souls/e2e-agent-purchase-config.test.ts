import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRequiredE2EPaymentCoinType } from '@web/lib/souls/e2e-agent-purchase-config'

describe('getRequiredE2EPaymentCoinType', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE from env', () => {
    vi.stubEnv('NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE', '0x2::usdc::USDC')
    expect(getRequiredE2EPaymentCoinType()).toBe('0x2::usdc::USDC')
  })

  it('throws an explicit error when the env var is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE', '')
    expect(() => getRequiredE2EPaymentCoinType()).toThrowError(
      'NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE is required for web/scripts/e2e-agent-purchase.ts',
    )
  })
})
