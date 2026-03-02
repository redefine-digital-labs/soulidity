import { describe, it, expect } from 'vitest'
import { tokenize, titleHash, jaccardSimilarity, SIMILARITY_THRESHOLD } from '../../src/collector/simhash.js'

describe('tokenize', () => {
  it('lowercases and splits words', () => {
    expect(tokenize('Bitcoin Surges Past')).toEqual(['bitcoin', 'surges', 'past'])
  })

  it('removes stop words', () => {
    expect(tokenize('the price of Bitcoin is rising')).toEqual(['price', 'bitcoin', 'rising'])
  })

  it('removes punctuation', () => {
    const result = tokenize('AI-powered DeFi: A new era')
    expect(result).toContain('ai')
    expect(result).toContain('powered')
    expect(result).toContain('defi')
  })
})

describe('titleHash', () => {
  it('returns 16-char hex string', () => {
    expect(titleHash('Bitcoin surges past $100K')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('same text produces same hash', () => {
    const a = titleHash('Bitcoin surges past $100K')
    const b = titleHash('Bitcoin surges past $100K')
    expect(a).toBe(b)
  })

  it('returns zero hash for empty text', () => {
    expect(titleHash('')).toBe('0000000000000000')
  })
})

describe('jaccardSimilarity', () => {
  it('identical titles have similarity 1', () => {
    expect(jaccardSimilarity('Bitcoin surges past $100K', 'Bitcoin surges past $100K')).toBe(1)
  })

  it('similar titles exceed threshold', () => {
    const sim = jaccardSimilarity(
      'Bitcoin surges past $100K milestone',
      'Bitcoin surges above $100K milestone',
    )
    // 4 shared words / 6 total = 0.67
    expect(sim).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD)
  })

  it('different titles are below threshold', () => {
    const sim = jaccardSimilarity(
      'Bitcoin surges past $100K milestone',
      'New AI agent framework released on GitHub',
    )
    expect(sim).toBeLessThan(SIMILARITY_THRESHOLD)
  })

  it('empty texts return expected values', () => {
    expect(jaccardSimilarity('', '')).toBe(1)
    expect(jaccardSimilarity('hello', '')).toBe(0)
  })
})
