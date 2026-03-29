import { describe, expect, it } from 'vitest'

import { sameSuiValue } from '../../web/lib/souls/on-chain-verification.ts'
import { sameSuiValueForTests } from './test-sui-value.ts'

describe('sameSuiValueForTests', () => {
  it.each([
    ['0x0', `0x${'0'.repeat(64)}`],
    ['0x', `0x${'0'.repeat(64)}`],
    ['0XAbC', `0x${'0'.repeat(61)}abc`],
    ['abc', `0x${'0'.repeat(61)}abc`],
    [`0x${'f'.repeat(64)}`, `0x${'f'.repeat(64)}`],
    ['xyz', 'xyz'],
  ])('matches production sameSuiValue for %s and %s', (left, right) => {
    expect(sameSuiValueForTests(left, right)).toBe(sameSuiValue(left, right))
  })
})
