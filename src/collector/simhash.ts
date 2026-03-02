// Title similarity for near-duplicate detection
// Uses word-set Jaccard similarity — reliable for short English titles

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on',
  'with', 'at', 'by', 'from', 'as', 'and', 'but', 'or', 'not', 'so',
  'yet', 'its', 'it', 'this', 'that', 'how', 'what', 'which', 'who',
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
}

// FNV-1a 64-bit hash — used as a compact fingerprint for DB storage
function fnv1a64(str: string): bigint {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash
}

export function titleHash(text: string): string {
  const tokens = tokenize(text)
  if (tokens.length === 0) return '0000000000000000'
  const sorted = [...new Set(tokens)].sort().join('|')
  return fnv1a64(sorted).toString(16).padStart(16, '0')
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a))
  const setB = new Set(tokenize(b))
  if (setA.size === 0 && setB.size === 0) return 1
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const word of setA) {
    if (setB.has(word)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return intersection / union
}

export const SIMILARITY_THRESHOLD = 0.6
