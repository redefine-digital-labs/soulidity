import { describe, expect, it } from 'vitest'

import {
  buildAgentTagLikePatterns,
  inferPersona,
  inferPersonaKind,
  tagMatchesAgentKeyword,
} from '../../web/lib/soulidity/persona'

describe('tagMatchesAgentKeyword', () => {
  it('matches exact keyword tags', () => {
    expect(tagMatchesAgentKeyword('agent')).toBe(true)
    expect(tagMatchesAgentKeyword('AI')).toBe(true)
    expect(tagMatchesAgentKeyword('on-chain')).toBe(true)
  })

  it('matches hyphen-delimited compound tags', () => {
    expect(tagMatchesAgentKeyword('ai-agent')).toBe(true)
    expect(tagMatchesAgentKeyword('trading-bot')).toBe(true)
    expect(tagMatchesAgentKeyword('autonomous-agent-v2')).toBe(true)
  })

  it('matches space-separated compound tags', () => {
    expect(tagMatchesAgentKeyword('AI Agent')).toBe(true)
    expect(tagMatchesAgentKeyword('research bot')).toBe(true)
    expect(tagMatchesAgentKeyword('on chain')).toBe(true)
    expect(tagMatchesAgentKeyword('autonomous agent v2')).toBe(true)
  })

  it('matches underscore-separated compound tags', () => {
    expect(tagMatchesAgentKeyword('ai_agent')).toBe(true)
    expect(tagMatchesAgentKeyword('research_bot')).toBe(true)
    expect(tagMatchesAgentKeyword('on_chain')).toBe(true)
  })

  it('does not match bare-substring false positives', () => {
    expect(tagMatchesAgentKeyword('maid')).toBe(false)
    expect(tagMatchesAgentKeyword('fairy')).toBe(false)
    expect(tagMatchesAgentKeyword('campaign')).toBe(false)
    expect(tagMatchesAgentKeyword('botanist')).toBe(false)
  })
})

describe('inferPersona', () => {
  it('classifies space-separated agent tags as agent', () => {
    expect(inferPersona(['cute', 'AI Agent'])).toBe('agent')
    expect(inferPersona(['research bot'])).toBe('agent')
  })

  it('classifies underscore-separated agent tags as agent', () => {
    expect(inferPersona(['ai_agent'])).toBe('agent')
  })

  it('falls back to character when no agent token is present', () => {
    expect(inferPersona(['maid', 'fairy'])).toBe('character')
    expect(inferPersona([])).toBe('character')
  })
})

describe('inferPersonaKind', () => {
  it('returns the database persona kind for agent-like tags', () => {
    expect(inferPersonaKind(['AI Agent'])).toBe('agents')
  })

  it('returns the database persona kind for character-like tags', () => {
    expect(inferPersonaKind(['maid', 'fairy'])).toBe('characters')
  })
})

describe('buildAgentTagLikePatterns', () => {
  it('emits exact, prefix, suffix, and middle hyphen-token patterns per keyword', () => {
    const patterns = buildAgentTagLikePatterns()
    expect(patterns).toContain('agent')
    expect(patterns).toContain('agent-%')
    expect(patterns).toContain('%-agent')
    expect(patterns).toContain('%-agent-%')
    expect(patterns).toContain('on-chain')
    expect(patterns).toContain('on-chain-%')
    expect(patterns).toContain('%-on-chain')
    expect(patterns).toContain('%-on-chain-%')
  })
})
