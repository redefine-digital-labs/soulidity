const KEYWORDS: { pattern: RegExp; weight: number }[] = [
  { pattern: /ai\s*agent/i, weight: 3 },
  { pattern: /web3\s*ai|ai\s*web3/i, weight: 3 },
  { pattern: /defi\s*ai|ai\s*defi/i, weight: 3 },
  { pattern: /on-?chain\s*ai/i, weight: 3 },
  { pattern: /llm\s*blockchain/i, weight: 3 },
  { pattern: /artificial\s*intelligence/i, weight: 1 },
  { pattern: /smart\s*contract/i, weight: 1 },
  { pattern: /defi/i, weight: 1 },
  { pattern: /machine\s*learning/i, weight: 1 },
  { pattern: /crypto/i, weight: 0.5 },
  { pattern: /blockchain/i, weight: 0.5 },
  { pattern: /nft/i, weight: 0.5 },
]

export function scoreItem(title: string, content: string): number {
  const text = `${title} ${content}`.toLowerCase()
  let score = 0
  for (const { pattern, weight } of KEYWORDS) {
    if (pattern.test(text)) {
      score += weight
    }
  }
  return score
}
