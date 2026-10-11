// Codex session log parser
// Parses JSONL files under ~/.codex/sessions/*/
// Coverage: partial — timestamps may be inferred from file mtime

import * as fs from 'node:fs'
import type { SessionParser, ParsedSession, ParsedTurn } from './types'
import { extractFileExtension, extractFilePathsFromInput } from './types'

/** Codex JSONL entry shapes */
interface CodexResponseItem {
  type: 'response_item'
  item?: {
    type: 'message' | 'function_call'
    role?: string
    name?: string
    arguments?: string
    content?: Array<{ type: string; text?: string }>
  }
}

interface CodexEventMsg {
  type: 'event_msg'
  event: string
  name?: string
  arguments?: string
}

type CodexEntry = CodexResponseItem | CodexEventMsg | { type: string }

function isResponseItem(entry: unknown): entry is CodexResponseItem {
  return typeof entry === 'object' && entry !== null && (entry as CodexResponseItem).type === 'response_item'
}

function isEventMsg(entry: unknown): entry is CodexEventMsg {
  return typeof entry === 'object' && entry !== null && (entry as CodexEventMsg).type === 'event_msg'
}

/** Count fenced code blocks in text */
function countCodeBlocks(text: string): number {
  const matches = text.match(/```/g)
  if (!matches) return 0
  return Math.floor(matches.length / 2)
}

function isTextContentBlock(block: unknown): block is { type: 'text'; text?: string } {
  return typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text'
}

/** Try parsing function_call arguments as JSON to extract file paths */
function extractPathsFromArguments(args: string | undefined): string[] {
  if (!args) return []
  try {
    const parsed = JSON.parse(args)
    return extractFilePathsFromInput(parsed)
  } catch {
    // Arguments might be a raw shell command
    const fileRefs = args.match(/[\w./~-]+\.\w{1,6}/g)
    return fileRefs || []
  }
}

export class CodexParser implements SessionParser {
  agentType = 'codex' as const

  parseSessionFile(filePath: string): ParsedSession | null {
    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      return null
    }

    const lines = content.split('\n').filter((l) => l.trim())
    if (lines.length === 0) return null

    const turns: ParsedTurn[] = []
    let fileMtimeMs = 0

    // Use file mtime as a fallback timestamp
    try {
      const stat = fs.statSync(filePath)
      fileMtimeMs = stat.mtimeMs
    } catch { /* ignore */ }

    // Derive sessionId from the parent directory name
    const sessionId = this.deriveSessionId(filePath)

    for (const line of lines) {
      let entry: CodexEntry
      try {
        entry = JSON.parse(line) as CodexEntry
      } catch {
        continue
      }

      if (isResponseItem(entry)) {
        const item = entry.item
        if (!item || typeof item !== 'object') continue

        if (item.type === 'message' && item.role === 'assistant') {
          // Assistant text response
          let textLength = 0
          let codeBlockCount = 0
          if (item.content && Array.isArray(item.content)) {
            for (const block of item.content) {
              if (isTextContentBlock(block) && block.text) {
                textLength += block.text.length
                codeBlockCount += countCodeBlocks(block.text)
              }
            }
          }

          turns.push({
            role: 'assistant',
            timestamp: 0, // Codex entries lack timestamps
            textLength,
            toolNames: [],
            codeBlockCount,
            fileExtensions: [],
          })
        } else if (item.type === 'function_call') {
          // Function call as a tool use turn
          const toolName = item.name || 'unknown'
          const paths = extractPathsFromArguments(item.arguments)
          const fileExtensions: string[] = []
          for (const p of paths) {
            const ext = extractFileExtension(p)
            if (ext) fileExtensions.push(ext)
          }

          turns.push({
            role: 'assistant',
            timestamp: 0,
            textLength: 0,
            toolNames: [toolName],
            codeBlockCount: 0,
            fileExtensions,
          })
        } else if (item.type === 'message' && item.role === 'user') {
          let textLength = 0
          if (item.content && Array.isArray(item.content)) {
            for (const block of item.content) {
              if (isTextContentBlock(block) && block.text) {
                textLength += block.text.length
              }
            }
          }
          turns.push({
            role: 'user',
            timestamp: 0,
            textLength,
            toolNames: [],
            codeBlockCount: 0,
            fileExtensions: [],
          })
        }
      } else if (isEventMsg(entry)) {
        if (entry.event === 'function_call' && entry.name) {
          const paths = extractPathsFromArguments(entry.arguments)
          const fileExtensions: string[] = []
          for (const p of paths) {
            const ext = extractFileExtension(p)
            if (ext) fileExtensions.push(ext)
          }

          turns.push({
            role: 'assistant',
            timestamp: 0,
            textLength: 0,
            toolNames: [entry.name],
            codeBlockCount: 0,
            fileExtensions,
          })
        }
      }
    }

    if (turns.length === 0) return null

    return {
      sessionId,
      startTime: fileMtimeMs,
      endTime: fileMtimeMs,
      turns,
    }
  }

  private deriveSessionId(filePath: string): string {
    // ~/.codex/sessions/<session-dir>/file.jsonl
    const parts = filePath.split('/')
    const sessionsIdx = parts.indexOf('sessions')
    if (sessionsIdx >= 0 && sessionsIdx + 1 < parts.length) {
      return parts[sessionsIdx + 1]
    }
    // Fallback: use filename
    return parts[parts.length - 1].replace('.jsonl', '')
  }
}
