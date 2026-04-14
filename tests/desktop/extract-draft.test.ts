import { describe, expect, it } from 'vitest'

import type { SoulProfile } from '@soulidity/shared'
import { createExtractSoulDraft, regenerateExtractSoulDraftContent } from '@soulidity/shared'

const sampleProfile: SoulProfile = {
  version: 1,
  personality: {
    traits: ['thorough', 'hands-on', 'systems-oriented'],
    communicationStyle: 'Direct, specific, and implementation-first.',
    expertise: ['TypeScript', 'Markdown', 'debugging'],
    workStyle: 'Persistent, investigative, and tool-heavy.',
  },
  evidence: {
    sessionCount: 18,
    turnCount: 264,
    topTools: ['Read', 'Edit', 'Bash'],
    primaryLanguages: ['TypeScript', 'Markdown'],
    peakHours: [10, 11, 14],
  },
  suggested: {
    name: 'JSON Thorough',
    description: 'A thorough, hands-on coding companion specializing in JSON and Markdown.',
    tags: ['thorough', 'hands-on', 'systems-oriented'],
  },
}

describe('extract draft helpers', () => {
  it('builds a local draft with assistant defaults and generated content', () => {
    const draft = createExtractSoulDraft(sampleProfile, {
      nowIso: '2026-04-13T12:00:00.000Z',
    })

    expect(draft.name).toBe('JSON Thorough')
    expect(draft.category).toBe('Assistant')
    expect(draft.royaltyBps).toBe(500)
    expect(draft.tags).toEqual(['thorough', 'hands-on', 'systems-oriented'])
    expect(draft.traits).toEqual(['thorough', 'hands-on', 'systems-oriented'])
    expect(draft.soulMarkdown).toContain('# JSON Thorough')
    expect(draft.soulMarkdown).toContain('Direct, specific, and implementation-first.')
    expect(draft.memoryMarkdown).toContain('18 coding sessions')
    expect(draft.coverImageDataUrl.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
  })

  it('regenerates markdown from structured extract fields without mutating the draft basics', () => {
    const initial = createExtractSoulDraft(sampleProfile, {
      nowIso: '2026-04-13T12:00:00.000Z',
    })

    const regenerated = regenerateExtractSoulDraftContent({
      ...initial,
      name: 'Systems Builder',
      description: 'A pragmatic builder for structured content systems.',
      communicationStyle: 'Calm, concrete, and terse.',
      expertise: ['TypeScript', 'content systems'],
      workStyle: 'Steady and skeptical.',
      traits: ['systematic', 'precise'],
    })

    expect(regenerated.name).toBe('Systems Builder')
    expect(regenerated.description).toBe('A pragmatic builder for structured content systems.')
    expect(regenerated.soulMarkdown).toContain('# Systems Builder')
    expect(regenerated.soulMarkdown).toContain('Calm, concrete, and terse.')
    expect(regenerated.soulMarkdown).toContain('content systems')
    expect(regenerated.memoryMarkdown).toContain('systematic')
  })
})
