export const SOUL_ENTRY_TYPES = ['founding-memory', 'memory-entry', 'skill-version'] as const
export const SOUL_WRITER_KINDS = ['founder', 'owner', 'granted-agent'] as const
export const SOUL_CATEGORIES = ['Trading', 'Research', 'Assistant', 'Creator'] as const

export type SoulEntryType = (typeof SOUL_ENTRY_TYPES)[number]
export type SoulWriterKindName = (typeof SOUL_WRITER_KINDS)[number]
export type SoulCategory = (typeof SOUL_CATEGORIES)[number]
export type SoulidityMetadata = Record<string, unknown>

export interface SkillMdFrontmatter {
  name: string
  description?: string
  metadata?: SoulidityMetadata | null
}

export interface ParsedSkillMd {
  frontmatter: SkillMdFrontmatter
  body: string
}

function stripQuotes(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

export function parseSkillMd(source: string): ParsedSkillMd {
  const normalized = source.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    throw new Error('SKILL.md frontmatter must start with ---')
  }

  const endIndex = normalized.indexOf('\n---\n', 4)
  if (endIndex === -1) {
    throw new Error('SKILL.md frontmatter must end with ---')
  }

  const frontmatterBlock = normalized.slice(4, endIndex)
  const body = normalized.slice(endIndex + 5).trimStart()
  const frontmatter: SkillMdFrontmatter = {
    name: '',
  }

  for (const rawLine of frontmatterBlock.split('\n')) {
    const match = rawLine.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/)
    if (!match) continue

    const key = match[1]
    const value = stripQuotes(match[2])
    if (!value) continue

    if (key === 'name') {
      frontmatter.name = value
      continue
    }
    if (key === 'description') {
      frontmatter.description = value
      continue
    }
    if (key === 'metadata') {
      try {
        const parsed = JSON.parse(value)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('metadata must be a JSON object')
        }
        frontmatter.metadata = parsed as SoulidityMetadata
      } catch {
        throw new Error('SKILL.md metadata must be valid single-line JSON')
      }
    }
  }

  if (!frontmatter.name) {
    throw new Error('SKILL.md frontmatter must include a non-empty name')
  }

  return {
    frontmatter,
    body,
  }
}
