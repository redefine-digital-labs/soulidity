import type { SessionScanResult, SoulProfile, ChatMessageData } from '@soulidity/shared'
import { loadLLMConfig } from '../llm/config'
import { streamChat } from '../llm/client'

// ── Aggregated intermediate type ──────────────

interface AggregatedFeatures {
  sessionCount: number
  turnCount: number
  avgTurnsPerSession: number
  avgResponseLength: number
  toolUsageFrequency: Record<string, number>
  topTools: string[]
  primaryLanguages: string[]
  avgSessionDurationMs: number
  peakHours: number[]
  usesCodeBlocks: boolean
  avgCodeBlocksPerResponse: number
}

// ── Public API ────────────────────────────────

/**
 * Analyze session scan results and generate a SoulProfile.
 * Uses LLM if configured, falls back to rule-based analysis.
 */
export async function analyzeSoulProfile(scanResults: SessionScanResult[]): Promise<SoulProfile> {
  const aggregated = aggregateScanResults(scanResults)

  // Try LLM first if configured
  const config = loadLLMConfig()
  if (config) {
    try {
      const profile = await analyzeWithLLM(aggregated)
      if (profile) return profile
    } catch {
      // LLM failed — fall through to rule-based
    }
  }

  return analyzeWithRules(aggregated)
}

// ── Aggregation ───────────────────────────────

function aggregateScanResults(results: SessionScanResult[]): AggregatedFeatures {
  if (results.length === 0) {
    return {
      sessionCount: 0,
      turnCount: 0,
      avgTurnsPerSession: 0,
      avgResponseLength: 0,
      toolUsageFrequency: {},
      topTools: [],
      primaryLanguages: [],
      avgSessionDurationMs: 0,
      peakHours: [],
      usesCodeBlocks: false,
      avgCodeBlocksPerResponse: 0,
    }
  }

  // Sum totals
  let sessionCount = 0
  let turnCount = 0
  for (const r of results) {
    sessionCount += r.sessionCount
    turnCount += r.totalTurns
  }

  // Merge tool usage frequency
  const mergedToolFreq: Record<string, number> = {}
  for (const r of results) {
    for (const [tool, freq] of Object.entries(r.features.toolUsageFrequency)) {
      mergedToolFreq[tool] = (mergedToolFreq[tool] ?? 0) + freq
    }
  }

  // Top tools by merged frequency
  const topTools = Object.entries(mergedToolFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tool]) => tool)

  // Deduplicate languages, preserve order of first appearance
  const seen = new Set<string>()
  const primaryLanguages: string[] = []
  for (const r of results) {
    for (const lang of r.features.primaryLanguages) {
      if (!seen.has(lang)) {
        seen.add(lang)
        primaryLanguages.push(lang)
      }
    }
  }

  // Weighted averages (weighted by session count)
  let weightedTurns = 0
  let weightedLength = 0
  let weightedDuration = 0
  let weightedCodeBlocks = 0
  let anyCodeBlocks = false

  for (const r of results) {
    const w = r.sessionCount
    weightedTurns += r.features.avgTurnsPerSession * w
    weightedLength += r.features.avgResponseLength * w
    weightedDuration += r.features.avgSessionDurationMs * w
    weightedCodeBlocks += r.features.avgCodeBlocksPerResponse * w
    if (r.features.usesCodeBlocks) anyCodeBlocks = true
  }

  const avgTurnsPerSession = sessionCount > 0 ? weightedTurns / sessionCount : 0
  const avgResponseLength = sessionCount > 0 ? weightedLength / sessionCount : 0
  const avgSessionDurationMs = sessionCount > 0 ? weightedDuration / sessionCount : 0
  const avgCodeBlocksPerResponse = sessionCount > 0 ? weightedCodeBlocks / sessionCount : 0

  // Merge peak hours: count frequency across all results, take top 3
  const hourCounts: Record<number, number> = {}
  for (const r of results) {
    for (const h of r.features.peakHours) {
      hourCounts[h] = (hourCounts[h] ?? 0) + 1
    }
  }
  const peakHours = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => Number(h))

  return {
    sessionCount,
    turnCount,
    avgTurnsPerSession,
    avgResponseLength,
    toolUsageFrequency: mergedToolFreq,
    topTools,
    primaryLanguages,
    avgSessionDurationMs,
    peakHours,
    usesCodeBlocks: anyCodeBlocks,
    avgCodeBlocksPerResponse,
  }
}

// ── LLM Analysis ──────────────────────────────

const SYSTEM_PROMPT = `You are analyzing coding behavior patterns to create a personality profile for an AI coding companion.
Based on the following coding statistics, generate a personality profile in JSON format.

IMPORTANT: Respond ONLY with valid JSON matching the schema below. No markdown, no explanation.

{
  "personality": {
    "traits": ["trait1", "trait2", "trait3"],
    "communicationStyle": "description",
    "expertise": ["area1", "area2"],
    "workStyle": "description"
  },
  "suggested": {
    "name": "Soul Name",
    "description": "One-line description",
    "tags": ["tag1", "tag2", "tag3"]
  }
}`

function buildUserMessage(a: AggregatedFeatures): string {
  const lines = [
    'Session Statistics:',
    `- Total sessions: ${a.sessionCount}`,
    `- Total turns: ${a.turnCount}`,
    `- Average turns per session: ${a.avgTurnsPerSession.toFixed(1)}`,
    `- Average response length: ${a.avgResponseLength.toFixed(0)} characters`,
    `- Peak coding hours: ${a.peakHours.join(', ') || 'unknown'}`,
    '',
    'Tool Usage:',
    `- Top tools: ${a.topTools.join(', ') || 'none'}`,
    `- Tool frequency: ${JSON.stringify(a.toolUsageFrequency)}`,
    '',
    'Languages:',
    `- Primary languages: ${a.primaryLanguages.join(', ') || 'unknown'}`,
    '',
    'Code Style:',
    `- Uses code blocks: ${a.usesCodeBlocks ? 'yes' : 'no'}`,
    `- Avg code blocks per response: ${a.avgCodeBlocksPerResponse.toFixed(1)}`,
  ]
  return lines.join('\n')
}

function chatOnce(history: ChatMessageData[], systemPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ctrl = streamChat(history, {
      onToken: () => {},
      onDone: (content) => resolve(content),
      onError: (code, msg) => reject(new Error(`${code}: ${msg}`)),
    }, { systemPrompt })

    // Timeout after 30s
    setTimeout(() => { ctrl.abort() }, 30_000)
  })
}

function extractJSON(text: string): string {
  // Strip markdown code block wrappers if present
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) return fenceMatch[1].trim()
  return text.trim()
}

interface LLMProfileResponse {
  personality: {
    traits: string[]
    communicationStyle: string
    expertise: string[]
    workStyle: string
  }
  suggested: {
    name: string
    description: string
    tags: string[]
  }
}

function isValidLLMResponse(obj: unknown): obj is LLMProfileResponse {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as Record<string, unknown>

  const p = o.personality
  if (!p || typeof p !== 'object') return false
  const pers = p as Record<string, unknown>
  if (!Array.isArray(pers.traits) || typeof pers.communicationStyle !== 'string') return false
  if (!Array.isArray(pers.expertise) || typeof pers.workStyle !== 'string') return false

  const s = o.suggested
  if (!s || typeof s !== 'object') return false
  const sug = s as Record<string, unknown>
  if (typeof sug.name !== 'string' || typeof sug.description !== 'string') return false
  if (!Array.isArray(sug.tags)) return false

  return true
}

async function analyzeWithLLM(aggregated: AggregatedFeatures): Promise<SoulProfile | null> {
  const userMessage = buildUserMessage(aggregated)
  const history: ChatMessageData[] = [{ role: 'user', content: userMessage }]

  const raw = await chatOnce(history, SYSTEM_PROMPT)
  const jsonStr = extractJSON(raw)

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    return null
  }

  if (!isValidLLMResponse(parsed)) return null

  return {
    version: 1,
    personality: parsed.personality,
    evidence: {
      sessionCount: aggregated.sessionCount,
      turnCount: aggregated.turnCount,
      topTools: aggregated.topTools,
      primaryLanguages: aggregated.primaryLanguages,
      peakHours: aggregated.peakHours,
    },
    suggested: parsed.suggested,
  }
}

// ── Rule-Based Analysis ───────────────────────

function analyzeWithRules(aggregated: AggregatedFeatures): SoulProfile {
  const traits: string[] = []

  // Tool-based traits
  if (aggregated.topTools.includes('Read')) traits.push('thorough')
  if (aggregated.topTools.includes('Edit')) traits.push('hands-on')
  if (aggregated.topTools.includes('Bash')) traits.push('systems-oriented')
  if (aggregated.topTools.includes('Grep') || aggregated.topTools.includes('Glob'))
    traits.push('investigative')

  // Session-based traits
  if (aggregated.avgTurnsPerSession > 20) traits.push('persistent')
  if (aggregated.avgTurnsPerSession < 5) traits.push('efficient')
  if (aggregated.avgResponseLength > 500) traits.push('detailed')
  if (aggregated.avgResponseLength < 100) traits.push('concise')

  // Time-based traits
  const { peakHours } = aggregated
  const isNightOwl = peakHours.some((h) => h >= 22 || h <= 4)
  const isEarlyBird = peakHours.some((h) => h >= 5 && h <= 8)
  if (isNightOwl) traits.push('night-owl')
  if (isEarlyBird) traits.push('early-bird')

  // Communication style
  const communicationStyle =
    aggregated.usesCodeBlocks && aggregated.avgCodeBlocksPerResponse > 2
      ? 'Code-heavy communicator who prefers showing over telling'
      : aggregated.avgResponseLength > 300
        ? 'Detailed communicator with comprehensive explanations'
        : 'Direct and concise communicator'

  // Expertise from languages
  const expertise = [...aggregated.primaryLanguages]

  // Work style
  const workStyle =
    aggregated.avgTurnsPerSession > 15
      ? 'Deep focus sessions with thorough exploration'
      : 'Quick, targeted sessions with efficient execution'

  // Suggested name based on primary language + trait
  const primaryLang = aggregated.primaryLanguages[0] ?? 'Code'
  const primaryTrait = traits[0] ?? 'Coder'
  const name = `${primaryLang} ${primaryTrait.charAt(0).toUpperCase() + primaryTrait.slice(1)}`

  // Ensure at least one trait for empty-input edge case
  if (traits.length === 0) traits.push('versatile')

  return {
    version: 1,
    personality: {
      traits: traits.slice(0, 5),
      communicationStyle,
      expertise,
      workStyle,
    },
    evidence: {
      sessionCount: aggregated.sessionCount,
      turnCount: aggregated.turnCount,
      topTools: aggregated.topTools,
      primaryLanguages: aggregated.primaryLanguages,
      peakHours: aggregated.peakHours,
    },
    suggested: {
      name,
      description: `A ${traits.slice(0, 2).join(', ')} coding companion specializing in ${expertise.slice(0, 2).join(' and ') || 'general coding'}`,
      tags: [...traits.slice(0, 3), ...expertise.slice(0, 2)],
    },
  }
}
