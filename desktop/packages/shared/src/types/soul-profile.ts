// Soul Profile types — session scanning and personality extraction
// Privacy invariant: NEVER store raw conversation text, only aggregated metrics

export interface SessionFeatures {
  avgTurnsPerSession: number
  avgResponseLength: number
  toolUsageFrequency: Record<string, number>
  topTools: string[]                    // top 5
  primaryLanguages: string[]            // from tool_use file extensions
  avgSessionDurationMs: number
  peakHours: number[]                   // 0-23, top 3
  usesCodeBlocks: boolean
  avgCodeBlocksPerResponse: number
}

export interface SessionScanResult {
  agentType: 'claude-code' | 'codex' | 'opencode'
  coverage: 'full' | 'partial'
  unsupportedMetrics: string[]
  sessionCount: number
  totalTurns: number
  scanPeriod: { from: number; to: number }  // epoch ms
  sourceFiles: string[]
  features: SessionFeatures
}

export interface SoulProfile {
  version: 1
  personality: {
    traits: string[]
    communicationStyle: string
    expertise: string[]
    workStyle: string
  }
  evidence: {
    sessionCount: number
    turnCount: number
    topTools: string[]
    primaryLanguages: string[]
    peakHours: number[]
  }
  suggested: {
    name: string
    description: string
    tags: string[]
  }
}

export interface ScanProgress {
  agentType: string
  phase: 'discovering' | 'parsing' | 'aggregating' | 'complete' | 'error'
  filesFound: number
  filesParsed: number
  error?: string
}
