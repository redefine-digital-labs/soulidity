import { describe, expect, it } from 'vitest'

import {
  SOUL_CATEGORIES,
  SOUL_ENTRY_TYPES,
  SOUL_WRITER_KINDS,
  parseSkillMd,
} from '@/lib/soulidity/content-schema'
import {
  FOUNDING_MEMORY_MD_TEMPLATE,
  SOUL_MD_TEMPLATE,
} from '@/lib/soulidity/content-templates'

describe('content schema', () => {
  it('parses SKILL.md frontmatter and preserves the markdown body', () => {
    const parsed = parseSkillMd(`---
name: market-scout
description: Tracks volatile market structure
metadata: {"scope":"markets","tier":"alpha"}
---
# Market Scout

Use this skill when the Soul needs a high-frequency market summary.
`)

    expect(parsed.frontmatter).toEqual({
      name: 'market-scout',
      description: 'Tracks volatile market structure',
      metadata: {
        scope: 'markets',
        tier: 'alpha',
      },
    })
    expect(parsed.body).toContain('# Market Scout')
  })

  it('rejects SKILL.md files without required frontmatter fields', () => {
    expect(() => parseSkillMd('# Missing frontmatter')).toThrow('SKILL.md frontmatter must start with ---')
    expect(() => parseSkillMd(`---
description: Missing name
---
# Broken
`)).toThrow('SKILL.md frontmatter must include a non-empty name')
  })

  it('exports the shipped Soulidity content enums', () => {
    expect(SOUL_ENTRY_TYPES).toEqual(['founding-memory', 'memory-entry', 'skill-version'])
    expect(SOUL_WRITER_KINDS).toEqual(['founder', 'owner', 'granted-agent'])
    expect(SOUL_CATEGORIES).toEqual(['Trading', 'Research', 'Assistant', 'Creator'])
  })
})

describe('content templates', () => {
  it('ships the OpenClaw-style five-section soul template', () => {
    expect(SOUL_MD_TEMPLATE).toContain('## Core Truths')
    expect(SOUL_MD_TEMPLATE).toContain('## Boundaries')
    expect(SOUL_MD_TEMPLATE).toContain('## Vibe')
    expect(SOUL_MD_TEMPLATE).toContain('## Knowledge')
    expect(SOUL_MD_TEMPLATE).toContain('## Continuity')
  })

  it('ships a dedicated founding memory template', () => {
    expect(FOUNDING_MEMORY_MD_TEMPLATE).toContain('# Founding Memory')
    expect(FOUNDING_MEMORY_MD_TEMPLATE).toContain('## Origin Snapshot')
    expect(FOUNDING_MEMORY_MD_TEMPLATE).toContain('## Initial Direction')
  })
})
