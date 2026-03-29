import { describe, expect, it } from 'vitest'
import { OnChainVerificationError } from '../../web/lib/souls/on-chain-verification.ts'
import { getClientSafeOnChainVerificationErrorMessage } from '../../web/lib/souls/route-safety.ts'

const unsafeMessages = [
  'Soul is missing on chain',
  'Soul is malformed on chain',
  'PersonalKioskCap cap.for nesting exceeds the supported on-chain depth',
  'allowlistVersion is not a valid integer on chain',
  'PersonalKioskCap is not a Move object',
  'Referenced object is not a SoulAllowlistCap',
  'Soul allowlist_address nesting exceeds the supported on-chain depth',
  'Unable to determine transaction sender for verification',
  'Pricing plan type is invalid on chain',
] as const

describe('route safety helpers', () => {
  it.each(unsafeMessages)('sanitizes unsafe verification message: %s', (message) => {
    const error = new OnChainVerificationError(message)

    expect(getClientSafeOnChainVerificationErrorMessage(error)).toBe('On-chain verification failed')
  })

  it('preserves client-safe verification errors', () => {
    const error = new OnChainVerificationError('Soul allowlist cap does not belong to this Soul')

    expect(getClientSafeOnChainVerificationErrorMessage(error)).toBe(
      'Soul allowlist cap does not belong to this Soul',
    )
  })
})
