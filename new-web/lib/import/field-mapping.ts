/**
 * Soul field auto-mapping heuristics.
 *
 * Only maps text-level fields (name, description).
 * File-level content (soul.md, memory.md, skills, cover image) must be uploaded separately.
 */

export type SoulTargetField =
  | 'name'
  | 'description'
  | 'skip'

export const SOUL_TARGET_LABELS: Record<SoulTargetField, string> = {
  name: 'Basic Info \u00b7 Name',
  description: 'Basic Info \u00b7 Description',
  skip: '\u2014 skip \u2014',
}

/** Dropdown options for the mapping table UI. */
export const MAPPING_OPTIONS: { value: SoulTargetField; label: string }[] = [
  { value: 'name', label: 'Basic Info \u00b7 Name' },
  { value: 'description', label: 'Basic Info \u00b7 Description' },
  { value: 'skip', label: '\u2014 skip \u2014' },
]

const MAPPING_RULES: Record<Exclude<SoulTargetField, 'skip'>, string[]> = {
  name: ['name', 'title', 'char_name', 'character_name', 'agent_name'],
  description: ['description', 'desc', 'bio', 'summary', 'about', 'overview', 'introduction'],
}

/** Total number of meaningful Soul target fields (excluding skip). */
const TOTAL_TARGET_FIELDS = Object.keys(MAPPING_RULES).length

export interface FieldMapping {
  sourceKey: string
  targetField: SoulTargetField
  confidence: number // 0-1
}

/**
 * Normalize a key for comparison: lowercase, strip underscores/hyphens, trim.
 */
function normalize(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '').trim()
}

/**
 * Auto-detect field mappings for a set of source keys.
 *
 * Returns a mapping for each source key (defaulting to 'skip' if no match).
 * Also returns a parsing score (0-100) indicating coverage.
 */
export function autoMapFields(sourceKeys: string[]): {
  mappings: FieldMapping[]
  parsingScore: number
} {
  const usedTargets = new Set<SoulTargetField>()
  const mappings: FieldMapping[] = []

  // Score each source key against all targets, pick best match
  const candidates: { sourceKey: string; target: SoulTargetField; score: number }[] = []

  for (const sourceKey of sourceKeys) {
    const norm = normalize(sourceKey)
    // Also handle dotted keys like "character.name" -> use last segment
    const segments = sourceKey.split('.')
    const lastSegment = normalize(segments[segments.length - 1])

    let bestTarget: SoulTargetField = 'skip'
    let bestScore = 0

    for (const [target, keywords] of Object.entries(MAPPING_RULES) as [Exclude<SoulTargetField, 'skip'>, string[]][]) {
      for (const keyword of keywords) {
        const normKeyword = normalize(keyword)
        let score = 0

        // Exact match on full key or last segment
        if (norm === normKeyword || lastSegment === normKeyword) {
          score = 1.0
        }
        // Substring match
        else if (norm.includes(normKeyword) || lastSegment.includes(normKeyword)) {
          score = 0.7
        }
        // Keyword contains the key (short key like "bio" in "biography")
        else if (normKeyword.includes(norm) && norm.length >= 3) {
          score = 0.5
        }

        if (score > bestScore) {
          bestScore = score
          bestTarget = target
        }
      }
    }

    if (bestScore >= 0.5) {
      candidates.push({ sourceKey, target: bestTarget, score: bestScore })
    } else {
      mappings.push({ sourceKey, targetField: 'skip', confidence: 0 })
    }
  }

  // Sort by score descending, assign targets greedily (each target used once)
  candidates.sort((a, b) => b.score - a.score)

  for (const candidate of candidates) {
    if (!usedTargets.has(candidate.target)) {
      usedTargets.add(candidate.target)
      mappings.push({
        sourceKey: candidate.sourceKey,
        targetField: candidate.target,
        confidence: candidate.score,
      })
    } else {
      mappings.push({ sourceKey: candidate.sourceKey, targetField: 'skip', confidence: 0 })
    }
  }

  // Restore original order
  mappings.sort((a, b) => sourceKeys.indexOf(a.sourceKey) - sourceKeys.indexOf(b.sourceKey))

  const mappedCount = new Set(
    mappings.filter((m) => m.targetField !== 'skip').map((m) => m.targetField),
  ).size
  const parsingScore = Math.round((mappedCount / TOTAL_TARGET_FIELDS) * 100)

  return { mappings, parsingScore }
}
