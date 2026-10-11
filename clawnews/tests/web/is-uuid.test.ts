import { describe, expect, it } from 'vitest'

import { isUuid } from '../../web/lib/is-uuid.ts'

describe('isUuid', () => {
  it('accepts existing v4 ids', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('accepts newer RFC-compatible uuid versions', () => {
    expect(isUuid('018f0f61-8d3c-7c93-a3ad-eb8f9e7d6d58')).toBe(true)
  })

  it('rejects non-uuid strings', () => {
    expect(isUuid('not-a-uuid')).toBe(false)
  })
})
