// Session Scanner — orchestrates multi-agent log parsing and aggregation
// Privacy: NEVER includes raw text in output — only counts, frequencies, and derived metrics

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { SessionScanResult, SessionFeatures, ScanProgress } from '@soulidity/shared'
import { ClaudeCodeParser } from './parsers/claude'
import { CodexParser } from './parsers/codex'
import { OpenCodeParser } from './parsers/opencode'
import type { ParsedSession, ParsedTurn } from './parsers/types'
import { EXT_TO_LANGUAGE } from './parsers/types'

// ── Agent log path configs (inline, not imported from agent-monitor to avoid coupling) ──

type AgentType = 'claude-code' | 'codex' | 'opencode'

interface ScanAgentConfig {
  agentType: AgentType
  logPaths: string[]
  filePatterns: string[]
}

const SCAN_CONFIGS: readonly ScanAgentConfig[] = [
  {
    agentType: 'claude-code',
    logPaths: [path.join(os.homedir(), '.claude', 'projects')],
    filePatterns: ['**/*.jsonl'],
  },
  {
    agentType: 'codex',
    logPaths: [path.join(os.homedir(), '.codex', 'sessions')],
    filePatterns: ['**/*.jsonl'],
  },
  {
    agentType: 'opencode',
    logPaths: [
      path.join(os.homedir(), '.local', 'share', 'opencode', 'storage', 'message'),
      path.join(os.homedir(), '.local', 'share', 'opencode', 'storage', 'part'),
    ],
    filePatterns: ['**/*.jsonl', '**/*.json'],
  },
]

// ── File discovery ──

/** Recursively find files matching given extension patterns */
function discoverFiles(basePaths: string[], filePatterns: string[]): string[] {
  const extensions = filePatterns
    .map((p) => { const m = p.match(/\*\.(\w+)$/); return m ? `.${m[1]}` : null })
    .filter((e): e is string => e !== null)

  const results: string[] = []

  for (const basePath of basePaths) {
    if (!fs.existsSync(basePath)) continue
    walkDir(basePath, extensions, results, 0)
  }

  return results
}

/** Walk directory tree up to 4 levels deep, collecting matching files */
function walkDir(dir: string, extensions: string[], results: string[], depth: number): void {
  if (depth > 4) return // Prevent runaway recursion

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkDir(fullPath, extensions, results, depth + 1)
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath)
    }
  }
}

// ── Aggregation ──

function aggregateFeatures(sessions: ParsedSession[], agentType: AgentType): SessionFeatures {
  const allTurns: ParsedTurn[] = sessions.flatMap((s) => s.turns)
  const assistantTurns = allTurns.filter((t) => t.role === 'assistant')

  // Tool usage frequency
  const toolFreq = new Map<string, number>()
  for (const turn of allTurns) {
    for (const tool of turn.toolNames) {
      toolFreq.set(tool, (toolFreq.get(tool) || 0) + 1)
    }
  }

  // Top 5 tools by frequency
  const topTools = [...toolFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name)

  // File extensions → languages
  const extSet = new Set<string>()
  for (const turn of allTurns) {
    for (const ext of turn.fileExtensions) {
      extSet.add(ext)
    }
  }
  const primaryLanguages = [...new Set(
    [...extSet]
      .map((ext) => EXT_TO_LANGUAGE[ext])
      .filter((lang): lang is string => !!lang)
  )]

  // Session durations
  const durations = sessions
    .filter((s) => s.startTime > 0 && s.endTime > 0 && s.endTime > s.startTime)
    .map((s) => s.endTime - s.startTime)
  const avgSessionDurationMs = durations.length > 0
    ? durations.reduce((sum, d) => sum + d, 0) / durations.length
    : 0

  // Peak hours — count turns per hour
  const hourCounts = new Array(24).fill(0) as number[]
  for (const turn of allTurns) {
    if (turn.timestamp > 0) {
      const hour = new Date(turn.timestamp).getHours()
      hourCounts[hour]++
    }
  }
  const peakHours = hourCounts
    .map((count, hour) => ({ hour, count }))
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((h) => h.hour)

  // Response length
  const totalResponseLength = assistantTurns.reduce((sum, t) => sum + t.textLength, 0)
  const avgResponseLength = assistantTurns.length > 0
    ? totalResponseLength / assistantTurns.length
    : 0

  // Code blocks
  const totalCodeBlocks = assistantTurns.reduce((sum, t) => sum + t.codeBlockCount, 0)
  const avgCodeBlocksPerResponse = assistantTurns.length > 0
    ? totalCodeBlocks / assistantTurns.length
    : 0

  return {
    avgTurnsPerSession: sessions.length > 0 ? allTurns.length / sessions.length : 0,
    avgResponseLength,
    toolUsageFrequency: Object.fromEntries(toolFreq),
    topTools,
    primaryLanguages,
    avgSessionDurationMs,
    peakHours,
    usesCodeBlocks: totalCodeBlocks > 0,
    avgCodeBlocksPerResponse,
  }
}

function computeUnsupportedMetrics(agentType: AgentType): string[] {
  switch (agentType) {
    case 'claude-code':
      return [] // Full coverage
    case 'codex':
      return ['avgSessionDurationMs', 'peakHours'] // No timestamps in entries
    case 'opencode':
      return ['avgSessionDurationMs', 'peakHours', 'avgCodeBlocksPerResponse'] // Best-effort
    default:
      return []
  }
}

// ── Public API ──

export async function scanSessions(
  options?: {
    onProgress?: (progress: ScanProgress) => void
    agentTypes?: AgentType[]
  }
): Promise<SessionScanResult[]> {
  const targetTypes = options?.agentTypes ?? ['claude-code', 'codex', 'opencode']
  const onProgress = options?.onProgress

  const results: SessionScanResult[] = []

  for (const config of SCAN_CONFIGS) {
    if (!targetTypes.includes(config.agentType)) continue

    // Phase: discovering
    onProgress?.({
      agentType: config.agentType,
      phase: 'discovering',
      filesFound: 0,
      filesParsed: 0,
    })

    let files: string[]
    try {
      files = discoverFiles(config.logPaths, config.filePatterns)
    } catch (err) {
      onProgress?.({
        agentType: config.agentType,
        phase: 'error',
        filesFound: 0,
        filesParsed: 0,
        error: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    onProgress?.({
      agentType: config.agentType,
      phase: 'parsing',
      filesFound: files.length,
      filesParsed: 0,
    })

    if (files.length === 0) continue

    // Phase: parsing
    const allSessions: ParsedSession[] = []
    let filesParsed = 0

    const parser = createParser(config.agentType)

    for (const file of files) {
      const nextFilesParsed = filesParsed + 1

      try {
        // For Claude Code, use the multi-session parser
        if (config.agentType === 'claude-code') {
          const claudeParser = parser as ClaudeCodeParser
          const sessions = claudeParser.parseAllSessions(file)
          allSessions.push(...sessions)
        } else {
          const session = parser.parseSessionFile(file)
          if (session) allSessions.push(session)
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        onProgress?.({
          agentType: config.agentType,
          phase: 'error',
          filesFound: files.length,
          filesParsed: nextFilesParsed,
          error: `Failed to parse ${path.basename(file)}: ${detail}`,
        })
      } finally {
        filesParsed = nextFilesParsed
      }

      if (filesParsed % 10 === 0 || filesParsed === files.length) {
        onProgress?.({
          agentType: config.agentType,
          phase: 'parsing',
          filesFound: files.length,
          filesParsed,
        })
      }
    }

    // Phase: aggregating
    onProgress?.({
      agentType: config.agentType,
      phase: 'aggregating',
      filesFound: files.length,
      filesParsed,
    })

    if (allSessions.length === 0) continue

    // Deduplicate sessions by sessionId (keep the one with more turns)
    const sessionMap = new Map<string, ParsedSession>()
    for (const session of allSessions) {
      const existing = sessionMap.get(session.sessionId)
      if (!existing || session.turns.length > existing.turns.length) {
        sessionMap.set(session.sessionId, session)
      }
    }
    const dedupedSessions = [...sessionMap.values()]

    const totalTurns = dedupedSessions.reduce((sum, s) => sum + s.turns.length, 0)
    const features = aggregateFeatures(dedupedSessions, config.agentType)
    const unsupportedMetrics = computeUnsupportedMetrics(config.agentType)

    // Compute scan period
    const allTimestamps = dedupedSessions.flatMap((s) => [s.startTime, s.endTime]).filter((t) => t > 0)
    const from = allTimestamps.length > 0 ? Math.min(...allTimestamps) : 0
    const to = allTimestamps.length > 0 ? Math.max(...allTimestamps) : 0

    results.push({
      agentType: config.agentType,
      coverage: config.agentType === 'claude-code' ? 'full' : 'partial',
      unsupportedMetrics,
      sessionCount: dedupedSessions.length,
      totalTurns,
      scanPeriod: { from, to },
      features,
    })

    onProgress?.({
      agentType: config.agentType,
      phase: 'complete',
      filesFound: files.length,
      filesParsed,
    })
  }

  return results
}

function createParser(agentType: AgentType) {
  switch (agentType) {
    case 'claude-code': return new ClaudeCodeParser()
    case 'codex': return new CodexParser()
    case 'opencode': return new OpenCodeParser()
  }
}
