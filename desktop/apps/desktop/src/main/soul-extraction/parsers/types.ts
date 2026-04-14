// Parser interface and shared types for session log parsing
// Privacy invariant: ParsedTurn stores only counts/names, NEVER raw text

export interface SessionParser {
  agentType: 'claude-code' | 'codex' | 'opencode'
  parseSessionFile(filePath: string): ParsedSession | null
}

export interface ParsedSession {
  sessionId: string
  startTime: number  // epoch ms
  endTime: number    // epoch ms
  turns: ParsedTurn[]
}

export interface ParsedTurn {
  role: 'user' | 'assistant'
  timestamp: number
  textLength: number      // character count, NOT the actual text
  toolNames: string[]     // tool names used in this turn
  codeBlockCount: number  // number of code blocks
  fileExtensions: string[] // extracted from tool_use file paths
}

/** Map file extension to language name */
export const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.sol': 'Solidity',
  '.move': 'Move',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.c': 'C',
  '.cpp': 'C++',
  '.h': 'C',
  '.hpp': 'C++',
  '.css': 'CSS',
  '.scss': 'CSS',
  '.html': 'HTML',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.json': 'JSON',
  '.toml': 'TOML',
  '.md': 'Markdown',
  '.prisma': 'Prisma',
}

/** Extract file extension from a path string */
export function extractFileExtension(filePath: string): string | null {
  const match = filePath.match(/(\.[a-zA-Z0-9]+)$/)
  return match ? match[1].toLowerCase() : null
}

/**
 * Extract all file path strings from a nested object.
 * Looks for common field names that contain file paths.
 */
export function extractFilePathsFromInput(input: unknown): string[] {
  if (!input || typeof input !== 'object') return []
  const paths: string[] = []
  const obj = input as Record<string, unknown>

  // Known path fields across different tools
  const pathFields = ['file_path', 'path', 'filePath', 'filename', 'file', 'target']
  for (const field of pathFields) {
    if (typeof obj[field] === 'string') {
      paths.push(obj[field] as string)
    }
  }

  // Also check command strings for file references (e.g. in Bash tool)
  if (typeof obj['command'] === 'string') {
    const cmd = obj['command'] as string
    // Extract paths from common patterns like: cat /path/to/file, vim file.ts, etc.
    const fileRefs = cmd.match(/[\w./~-]+\.\w{1,6}/g)
    if (fileRefs) {
      paths.push(...fileRefs)
    }
  }

  return paths
}
