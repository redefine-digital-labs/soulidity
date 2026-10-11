import { describe, expect, it } from 'vitest'

import { toProjectionBigInt, toProjectionNumber } from '@soulidity/sdk'

describe('projection scalar conversions', () => {
  it('round-trips supported millisecond timestamps across bigint storage', () => {
    const createdAtMs = 1_750_000_000_000

    expect(toProjectionBigInt(createdAtMs, 'createdAtMs')).toBe(1_750_000_000_000n)
    expect(toProjectionNumber(1_750_000_000_000n, 'createdAtMs')).toBe(createdAtMs)
  })

  it('rejects unsafe numbers before writing bigint columns', () => {
    expect(() => toProjectionBigInt(Number.MAX_SAFE_INTEGER + 1, 'createdAtMs')).toThrow(/supported integer range/)
  })

  it('rejects bigint values that cannot be represented in JSON responses', () => {
    expect(() => toProjectionNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'createdAtMs')).toThrow(/JSON-safe integer range/)
  })
})
