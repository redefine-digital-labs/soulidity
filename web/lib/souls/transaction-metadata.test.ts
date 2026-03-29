import { describe, expect, it } from 'vitest'
import { readNormalizedSuiValue, readTransactionSender } from '@web/lib/souls/transaction-metadata'

describe('transaction metadata helpers', () => {
  it('normalizes valid Sui values and rejects invalid ones', () => {
    expect(readNormalizedSuiValue('0x2')).toBe('0x0000000000000000000000000000000000000000000000000000000000000002')
    expect(readNormalizedSuiValue('not-a-sui-value')).toBeNull()
    expect(readNormalizedSuiValue(123)).toBeNull()
  })

  it('reads and normalizes transaction sender', () => {
    expect(
      readTransactionSender({
        transaction: {
          data: {
            sender: '0xabc',
          },
        },
      }),
    ).toBe('0x0000000000000000000000000000000000000000000000000000000000000abc')

    expect(
      readTransactionSender({
        transaction: {
          data: {
            sender: 'invalid',
          },
        },
      }),
    ).toBeNull()
  })
})
