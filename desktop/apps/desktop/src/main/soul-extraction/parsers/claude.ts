// Claude Code session log parser
// Parses JSONL files under ~/.claude/projects/*/
// Privacy: only extracts counts and tool names, never raw text

import * as fs from 'node:fs'
import type { SessionParser, ParsedSession, ParsedTurn } from './types'
import { extractFileExtension, extractFilePathsFromInput } from './types'

/** Shape of a Claude Code JSONL entry (only fields we read) */
interface ClaudeLogEntry {
  type?: string
  subtype?: string
  sessionId?: string
  timestamp?: string
  durationMs?: number
  message?: {
    role?: string
    content?: unknown[]
  }
}

/** Content block types inside message.content */
interface TextBlock {
  type: 'text'
  text: string
}

interface ToolUseBlock {
  type: 'tool_use'
  name: string
  input?: unknown
}

type ContentBlock = TextBlock | ToolUseBlock | { type: string }

function isTextBlock(block: unknown): block is TextBlock {
  return typeof block === 'object' && block !== null && (block as TextBlock).type === 'text'
}

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return typeof block === 'object' && block !== null && (block as ToolUseBlock).type === 'tool_use'
}

/** Count fenced code blocks (``` ... ```) in text */
function countCodeBlocks(text: string): number {
  const matches = text.match(/```/g)
  if (!matches) return 0
  // Each code block has an opening and closing ```, so divide by 2
  return Math.floor(matches.length / 2)
}

/** Parse a single JSONL line into a structured entry, or null if malformed */
function parseLogLine(line: string): ClaudeLogEntry | null {
  try {
    const parsed = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as ClaudeLogEntry
  } catch {
    return null
  }
}

/** Intermediate accumulator for grouping entries by session */
interface SessionAccumulator {
  sessionId: string
  turns: ParsedTurn[]
  timestamps: number[]
}

export class ClaudeCodeParser implements SessionParser {
  agentType = 'claude-code' as const

  parseSessionFile(filePath: string): ParsedSession | null {
    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      return null
    }

    const lines = content.split('\n').filter((l) => l.trim())
    if (lines.length === 0) return null

    // Group entries by sessionId
    const sessions = new Map<string, SessionAccumulator>()

    for (const line of lines) {
      const entry = parseLogLine(line)
      if (!entry || !entry.sessionId) continue

      let acc = sessions.get(entry.sessionId)
      if (!acc) {
        acc = { sessionId: entry.sessionId, turns: [], timestamps: [] }
        sessions.set(entry.sessionId, acc)
      }

      // Track timestamp
      if (entry.timestamp) {
        const ts = new Date(entry.timestamp).getTime()
        if (!isNaN(ts)) {
          acc.timestamps.push(ts)
        }
      }

      // Skip non-message entries (system events, etc.)
      if (!entry.message?.content || !Array.isArray(entry.message.content)) continue

      const role = entry.message.role
      if (role !== 'user' && role !== 'assistant') continue

      const turn = this.parseTurn(role, entry)
      acc.turns.push(turn)
    }

    // Return the first session found (each file typically has one session,
    // but we merge all entries for multi-session files via the scanner)
    if (sessions.size === 0) return null

    // For a single-file parse, return the session with the most turns
    let bestSession: SessionAccumulator | null = null
    for (const acc of sessions.values()) {
      if (!bestSession || acc.turns.length > bestSession.turns.length) {
        bestSession = acc
      }
    }

    if (!bestSession || bestSession.turns.length === 0) return null

    const startTime = bestSession.timestamps.length > 0
      ? Math.min(...bestSession.timestamps)
      : 0
    const endTime = bestSession.timestamps.length > 0
      ? Math.max(...bestSession.timestamps)
      : 0

    return {
      sessionId: bestSession.sessionId,
      startTime,
      endTime,
      turns: bestSession.turns,
    }
  }

  /**
   * Parse all sessions from a JSONL file.
   * Unlike parseSessionFile (which returns one), this returns all sessions found.
   */
  parseAllSessions(filePath: string): ParsedSession[] {
    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      return []
    }

    const lines = content.split('\n').filter((l) => l.trim())
    if (lines.length === 0) return []

    const sessions = new Map<string, SessionAccumulator>()

    for (const line of lines) {
      const entry = parseLogLine(line)
      if (!entry || !entry.sessionId) continue

      let acc = sessions.get(entry.sessionId)
      if (!acc) {
        acc = { sessionId: entry.sessionId, turns: [], timestamps: [] }
        sessions.set(entry.sessionId, acc)
      }

      if (entry.timestamp) {
        const ts = new Date(entry.timestamp).getTime()
        if (!isNaN(ts)) acc.timestamps.push(ts)
      }

      if (!entry.message?.content || !Array.isArray(entry.message.content)) continue

      const role = entry.message.role
      if (role !== 'user' && role !== 'assistant') continue

      acc.turns.push(this.parseTurn(role, entry))
    }

    const results: ParsedSession[] = []
    for (const acc of sessions.values()) {
      if (acc.turns.length === 0) continue
      results.push({
        sessionId: acc.sessionId,
        startTime: acc.timestamps.length > 0 ? Math.min(...acc.timestamps) : 0,
        endTime: acc.timestamps.length > 0 ? Math.max(...acc.timestamps) : 0,
        turns: acc.turns,
      })
    }
    return results
  }

  private parseTurn(role: 'user' | 'assistant', entry: ClaudeLogEntry): ParsedTurn {
    const contentBlocks = entry.message!.content as ContentBlock[]
    const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : 0

    let textLength = 0
    let codeBlockCount = 0
    const toolNames: string[] = []
    const fileExtensions: string[] = []

    for (const block of contentBlocks) {
      if (isTextBlock(block)) {
        textLength += block.text.length
        if (role === 'assistant') {
          codeBlockCount += countCodeBlocks(block.text)
        }
      } else if (isToolUseBlock(block)) {
        toolNames.push(block.name)
        // Extract file extensions from tool input
        const paths = extractFilePathsFromInput(block.input)
        for (const p of paths) {
          const ext = extractFileExtension(p)
          if (ext) fileExtensions.push(ext)
        }
      }
    }

    return {
      role,
      timestamp,
      textLength,
      toolNames,
      codeBlockCount,
      fileExtensions,
    }
  }
}
