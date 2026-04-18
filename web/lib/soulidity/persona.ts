// Shared persona classification for Soul listings. Used by both the client
// marketplace tabs and the server-side `/api/souls` query so the two cannot
// drift apart and leave a page of pre-paginated results filtered to empty.

export const AGENT_KEYWORDS = [
  'ai',
  'agent',
  'bot',
  'trading',
  'research',
  'infrastructure',
  'automation',
  'defi',
  'on-chain',
] as const

export type PersonaFilter = 'all' | 'agents' | 'characters'

export function parsePersonaFilter(value: string | null | undefined): PersonaFilter {
  if (value === 'agents' || value === 'characters') return value
  return 'all'
}

// Normalize a tag for keyword matching: lowercase and collapse any
// whitespace or underscore runs into a single hyphen. Free-form tags
// like "AI Agent", "research_bot", or "on chain" then share the same
// hyphen-token shape as the curated keyword list.
function normalizeTagForMatch(tag: string): string {
  return tag.toLowerCase().replace(/[\s_]+/g, '-')
}

// Token-aware keyword match. A tag counts as an agent tag when the
// normalized tag equals a keyword or contains the keyword as a
// hyphen-delimited token. This avoids false positives like "maid",
// "fairy", or "campaign" that happen to contain the bare substring "ai".
export function tagMatchesAgentKeyword(tag: string): boolean {
  const t = normalizeTagForMatch(tag)
  return AGENT_KEYWORDS.some(
    (kw) => t === kw || t.startsWith(`${kw}-`) || t.endsWith(`-${kw}`) || t.includes(`-${kw}-`),
  )
}

export function inferPersona(tags: string[]): 'agent' | 'character' {
  return tags.some(tagMatchesAgentKeyword) ? 'agent' : 'character'
}

// SQL LIKE patterns that encode the same token-boundary semantics as
// `tagMatchesAgentKeyword`, so the server-side persona filter matches the
// client-side classifier. Patterns expect the tag to have been lowercased.
export function buildAgentTagLikePatterns(): string[] {
  return AGENT_KEYWORDS.flatMap((kw) => [kw, `${kw}-%`, `%-${kw}`, `%-${kw}-%`])
}
