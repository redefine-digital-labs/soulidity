// OpenCode session log parser
// Parses message files from ~/.local/share/opencode/storage/message/
// and part files from ~/.local/share/opencode/storage/part/
// Coverage: partial — best-effort extraction

import * as fs from 'node:fs'
import type { SessionParser, ParsedSession, ParsedTurn } from './types'
import { extractFileExtension, extractFilePathsFromInput } from './types'

/** OpenCode message entry */
interface OpenCodeMessage {
  id?: string
  sessionId?: string
  role?: string
  content?: string
  createdAt?: string
}

/** OpenCode part entry */
interface OpenCodePart {
  id?: string
  messageId?: string
  type?: string
  toolName?: string
  content?: string
  input?: unknown
}

/** Count fenced code blocks in text */
function countCodeBlocks(text: string): number {
  const matches = text.match(/```/g)
  if (!matches) return 0
  return Math.floor(matches.length / 2)
}

export class OpenCodeParser implements SessionParser {
  agentType = 'opencode' as const

  parseSessionFile(filePath: string): ParsedSession | null {
    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      return null
    }

    // Try parsing as JSONL (multiple lines) or single JSON
    const entries = this.parseEntries(content)
    if (entries.length === 0) return null

    // Detect if these are message entries or part entries
    const firstEntry = entries[0]
    if (this.isMessageEntry(firstEntry)) {
      return this.parseMessageFile(entries as OpenCodeMessage[], filePath)
    } else if (this.isPartEntry(firstEntry)) {
      return this.parsePartFile(entries as OpenCodePart[], filePath)
    }

    return null
  }

  /**
   * Parse part files separately so the scanner can merge them with message data.
   * Returns tool usage information keyed by messageId.
   */
  parsePartEntries(filePath: string): Map<string, { toolNames: string[]; fileExtensions: string[] }> {
    const result = new Map<string, { toolNames: string[]; fileExtensions: string[] }>()

    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      return result
    }

    const entries = this.parseEntries(content)
    for (const entry of entries) {
      if (!this.isPartEntry(entry)) continue
      const part = entry as OpenCodePart
      if (!part.messageId) continue

      let existing = result.get(part.messageId)
      if (!existing) {
        existing = { toolNames: [], fileExtensions: [] }
        result.set(part.messageId, existing)
      }

      if (part.type === 'tool-invocation' && part.toolName) {
        existing.toolNames.push(part.toolName)
        if (part.input) {
          const paths = extractFilePathsFromInput(part.input)
          for (const p of paths) {
            const ext = extractFileExtension(p)
            if (ext) existing.fileExtensions.push(ext)
          }
        }
      }
    }

    return result
  }

  private parseEntries(content: string): unknown[] {
    const results: unknown[] = []

    // Try as JSONL first
    const lines = content.split('\n').filter((l) => l.trim())
    for (const line of lines) {
      try {
        results.push(JSON.parse(line))
      } catch {
        // If JSONL parsing fails on first line, try as single JSON
        if (results.length === 0) {
          try {
            const parsed = JSON.parse(content)
            if (Array.isArray(parsed)) return parsed
            return [parsed]
          } catch {
            return []
          }
        }
      }
    }

    return results
  }

  private isMessageEntry(entry: unknown): entry is OpenCodeMessage {
    if (typeof entry !== 'object' || entry === null) return false
    const e = entry as Record<string, unknown>
    return typeof e.role === 'string' || typeof e.sessionId === 'string'
  }

  private isPartEntry(entry: unknown): entry is OpenCodePart {
    if (typeof entry !== 'object' || entry === null) return false
    const e = entry as Record<string, unknown>
    return typeof e.messageId === 'string' || e.type === 'tool-invocation' || e.type === 'text'
  }

  private parseMessageFile(messages: OpenCodeMessage[], filePath: string): ParsedSession | null {
    const turns: ParsedTurn[] = []
    const timestamps: number[] = []
    let sessionId = ''

    for (const msg of messages) {
      if (msg.sessionId && !sessionId) {
        sessionId = msg.sessionId
      }

      if (msg.createdAt) {
        const ts = new Date(msg.createdAt).getTime()
        if (!isNaN(ts)) timestamps.push(ts)
      }

      const role = msg.role
      if (role !== 'user' && role !== 'assistant') continue

      const textContent = typeof msg.content === 'string' ? msg.content : ''

      turns.push({
        role,
        timestamp: msg.createdAt ? new Date(msg.createdAt).getTime() : 0,
        textLength: textContent.length,
        toolNames: [],
        codeBlockCount: role === 'assistant' ? countCodeBlocks(textContent) : 0,
        fileExtensions: [],
      })
    }

    if (turns.length === 0) return null

    // Derive sessionId from directory or first entry
    if (!sessionId) {
      const parts = filePath.split('/')
      sessionId = parts[parts.length - 1].replace(/\.\w+$/, '')
    }

    return {
      sessionId,
      startTime: timestamps.length > 0 ? Math.min(...timestamps) : 0,
      endTime: timestamps.length > 0 ? Math.max(...timestamps) : 0,
      turns,
    }
  }

  private parsePartFile(parts: OpenCodePart[], filePath: string): ParsedSession | null {
    // Part files alone don't form complete sessions, but we can extract tool usage
    const turns: ParsedTurn[] = []
    let sessionId = ''

    for (const part of parts) {
      if (part.type === 'tool-invocation' && part.toolName) {
        const fileExtensions: string[] = []
        if (part.input) {
          const paths = extractFilePathsFromInput(part.input)
          for (const p of paths) {
            const ext = extractFileExtension(p)
            if (ext) fileExtensions.push(ext)
          }
        }
        turns.push({
          role: 'assistant',
          timestamp: 0,
          textLength: 0,
          toolNames: [part.toolName],
          codeBlockCount: 0,
          fileExtensions,
        })
      } else if (part.type === 'text' && part.content) {
        turns.push({
          role: 'assistant',
          timestamp: 0,
          textLength: part.content.length,
          toolNames: [],
          codeBlockCount: countCodeBlocks(part.content),
          fileExtensions: [],
        })
      }
    }

    if (turns.length === 0) return null

    const pathParts = filePath.split('/')
    sessionId = sessionId || pathParts[pathParts.length - 1].replace(/\.\w+$/, '')

    return {
      sessionId,
      startTime: 0,
      endTime: 0,
      turns,
    }
  }
}
