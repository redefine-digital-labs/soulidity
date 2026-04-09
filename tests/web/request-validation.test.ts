import { describe, expect, it } from 'vitest'

import {
  parseRequiredAddress,
  parseOptionalObjectId,
  parseOptionalTxDigest,
  parseRequiredObjectId,
  parseRequiredTxDigest,
} from '../../web/lib/souls/request-validation.ts'

const VALID_OBJECT_ID = `0x${'a'.repeat(64)}`
const VALID_TX_DIGEST = '4'.repeat(44)

describe('soul request validation', () => {
  it('accepts canonical Sui object ids', () => {
    expect(parseRequiredObjectId(VALID_OBJECT_ID)).toBe(VALID_OBJECT_ID)
  })

  it('rejects non-hex object ids before they reach Sui RPC', () => {
    expect(parseRequiredObjectId('not-an-object-id')).toBeNull()
  })

  it('accepts canonical Sui addresses via the address-specific alias', () => {
    expect(parseRequiredAddress(VALID_OBJECT_ID)).toBe(VALID_OBJECT_ID)
  })

  it('accepts base58 transaction digests', () => {
    expect(parseRequiredTxDigest(VALID_TX_DIGEST)).toBe(VALID_TX_DIGEST)
  })

  it('rejects non-base58 digests before they reach Sui RPC', () => {
    expect(parseRequiredTxDigest('0xtx')).toBeNull()
  })

  it('treats missing optional digests as absent instead of invalid', () => {
    expect(parseOptionalTxDigest(null)).toBeNull()
    expect(parseOptionalTxDigest(undefined)).toBeNull()
  })

  it('normalizes optional object ids when present and rejects malformed values', () => {
    expect(parseOptionalObjectId(VALID_OBJECT_ID.toUpperCase())).toBe(VALID_OBJECT_ID)
    expect(parseOptionalObjectId('not-an-object-id')).toBeNull()
  })
})
