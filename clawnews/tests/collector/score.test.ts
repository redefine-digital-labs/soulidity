import { describe, it, expect } from 'vitest'
import { scoreItem } from '../../src/collector/score.js'

describe('scoreItem', () => {
  it('scores high for AI agent + web3 keywords', () => {
    const score = scoreItem('AI Agent for DeFi trading', 'An AI agent that trades on-chain')
    expect(score).toBeGreaterThanOrEqual(3)
  })

  it('scores medium for single-domain keywords', () => {
    const score = scoreItem('New Smart Contract Framework', 'A framework for smart contracts')
    expect(score).toBeGreaterThanOrEqual(1)
    expect(score).toBeLessThan(3)
  })

  it('scores low for generic crypto', () => {
    const score = scoreItem('Bitcoin Hits New High', 'Bitcoin price surges')
    expect(score).toBeLessThanOrEqual(1)
  })

  it('is case insensitive', () => {
    const score = scoreItem('AI AGENT Web3', '')
    expect(score).toBeGreaterThanOrEqual(3)
  })
})
