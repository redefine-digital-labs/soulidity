import { describe, expect, it } from 'vitest'
import { resolveArticleStatusFilter } from '../../web/lib/article-query-access.js'

describe('resolveArticleStatusFilter', () => {
  it('defaults anonymous requests to published items', () => {
    expect(resolveArticleStatusFilter(null, false)).toEqual({
      allowed: true,
      status: 'published',
    })
  })

  it('rejects anonymous requests for non-published statuses', () => {
    expect(resolveArticleStatusFilter('draft', false)).toEqual({
      allowed: false,
      status: null,
    })
  })

  it('preserves unfiltered admin access', () => {
    expect(resolveArticleStatusFilter(null, true)).toEqual({
      allowed: true,
      status: null,
    })
  })
})
