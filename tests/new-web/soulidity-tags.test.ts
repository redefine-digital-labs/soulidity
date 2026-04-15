import { describe, expect, it } from 'vitest'

import { normalizeTags } from '../../web/lib/soulidity/tags'

describe('normalizeTags', () => {
  it('trims whitespace and drops empty', () => {
    expect(normalizeTags(['  foo  ', '', '  '])).toEqual(['foo'])
  })

  it('lowercases all tags including MBTI', () => {
    expect(normalizeTags(['enfp', 'INTJ'])).toEqual(['enfp', 'intj'])
  })

  it('deduplicates case-insensitively', () => {
    expect(normalizeTags(['Trading', 'trading', 'TRADING'])).toEqual(['trading'])
  })

  it('caps at 12 tags', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag${i}`)
    expect(normalizeTags(tags)).toHaveLength(12)
  })

  it('caps tag length at 50 chars', () => {
    const long = 'a'.repeat(100)
    expect(normalizeTags([long])[0]).toHaveLength(50)
  })
})
