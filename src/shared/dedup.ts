const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
  'those', 'it', 'its', 'as', 'not', 'no', 'so', 'if', 'than', 'too',
  'very', 'just', 'about', 'up', 'out', 'how', 'what', 'which', 'who',
  'whom', 'when', 'where', 'why', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'into', 'over', 'after',
  'before', 'yet',
])

const EMPTY_HASH = '0000000000000000'
const MAX_CONTENT_TOKENS = 80
const MIN_CONTENT_TOKENS = 6
const CONTENT_HASH_TITLE_THRESHOLD = 0.35
const TITLE_WITH_CONTENT_THRESHOLD = 0.45
const CONTENT_SIMILARITY_THRESHOLD = 0.55
const TRACKING_PARAM_PREFIXES = ['utm_']
const TRACKING_PARAM_NAMES = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
])

export const SIMILARITY_THRESHOLD = 0.65

export interface DedupCandidate {
  title: string
  content?: string | null
  url?: string | null
}

export interface DedupReference extends DedupCandidate {
  id: string
}

export interface DuplicateMatch {
  matchedId: string
  reason: 'url' | 'title_hash' | 'title_similarity' | 'content_hash' | 'title_content'
  titleSimilarity: number
  contentSimilarity: number
}

export function tokenize(text: string, maxTokens = Number.POSITIVE_INFINITY): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .slice(0, maxTokens)
}

export function tokenSetJaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  if (a.length === 0 || b.length === 0) return 0

  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0

  for (const token of setA) {
    if (setB.has(token)) intersection++
  }

  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

function fnv1a64(text: string): bigint {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash
}

function stableHash(tokens: string[]): string {
  if (tokens.length === 0) return EMPTY_HASH
  const unique = [...new Set(tokens)].sort().join('|')
  return fnv1a64(unique).toString(16).padStart(16, '0')
}

export function titleHash(text: string): string {
  return stableHash(tokenize(text))
}

export function jaccardSimilarity(a: string, b: string, maxTokens = Number.POSITIVE_INFINITY): number {
  return tokenSetJaccard(tokenize(a, maxTokens), tokenize(b, maxTokens))
}

export function normalizeUrl(url: string | null | undefined): string {
  if (!url) return ''

  try {
    const parsed = new URL(url)
    parsed.hash = ''

    for (const key of [...parsed.searchParams.keys()]) {
      const lowerKey = key.toLowerCase()
      if (TRACKING_PARAM_PREFIXES.some((prefix) => lowerKey.startsWith(prefix)) || TRACKING_PARAM_NAMES.has(lowerKey)) {
        parsed.searchParams.delete(key)
      }
    }

    if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
      parsed.port = ''
    }

    if (parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    }

    parsed.searchParams.sort()
    return parsed.toString()
  } catch {
    return url.trim()
  }
}

function contentHash(text: string | null | undefined): string {
  return stableHash(tokenize(text ?? '', MAX_CONTENT_TOKENS))
}

export function findDuplicateMatch(candidate: DedupCandidate, references: DedupReference[]): DuplicateMatch | null {
  const candidateUrl = normalizeUrl(candidate.url)
  const candidateTitleHash = titleHash(candidate.title)
  const candidateTitleTokens = tokenize(candidate.title)
  const candidateContentTokens = tokenize(candidate.content ?? '', MAX_CONTENT_TOKENS)
  const candidateContentHash = stableHash(candidateContentTokens)
  const candidateHasContent = candidateContentTokens.length >= MIN_CONTENT_TOKENS

  for (const reference of references) {
    const referenceUrl = normalizeUrl(reference.url)
    const titleSimilarity = tokenSetJaccard(candidateTitleTokens, tokenize(reference.title))

    if (candidateUrl && referenceUrl && candidateUrl === referenceUrl) {
      return {
        matchedId: reference.id,
        reason: 'url',
        titleSimilarity,
        contentSimilarity: tokenSetJaccard(candidateContentTokens, tokenize(reference.content ?? '', MAX_CONTENT_TOKENS)),
      }
    }

    if (candidateTitleHash !== EMPTY_HASH && candidateTitleHash === titleHash(reference.title)) {
      return {
        matchedId: reference.id,
        reason: 'title_hash',
        titleSimilarity: 1,
        contentSimilarity: tokenSetJaccard(candidateContentTokens, tokenize(reference.content ?? '', MAX_CONTENT_TOKENS)),
      }
    }

    if (titleSimilarity >= SIMILARITY_THRESHOLD) {
      return {
        matchedId: reference.id,
        reason: 'title_similarity',
        titleSimilarity,
        contentSimilarity: tokenSetJaccard(candidateContentTokens, tokenize(reference.content ?? '', MAX_CONTENT_TOKENS)),
      }
    }

    const referenceContentTokens = tokenize(reference.content ?? '', MAX_CONTENT_TOKENS)
    if (!candidateHasContent || referenceContentTokens.length < MIN_CONTENT_TOKENS) {
      continue
    }

    const contentSimilarity = tokenSetJaccard(candidateContentTokens, referenceContentTokens)
    const referenceContentHash = contentHash(reference.content)

    if (candidateContentHash !== EMPTY_HASH && candidateContentHash === referenceContentHash && titleSimilarity >= CONTENT_HASH_TITLE_THRESHOLD) {
      return {
        matchedId: reference.id,
        reason: 'content_hash',
        titleSimilarity,
        contentSimilarity,
      }
    }

    if (titleSimilarity >= TITLE_WITH_CONTENT_THRESHOLD && contentSimilarity >= CONTENT_SIMILARITY_THRESHOLD) {
      return {
        matchedId: reference.id,
        reason: 'title_content',
        titleSimilarity,
        contentSimilarity,
      }
    }
  }

  return null
}
