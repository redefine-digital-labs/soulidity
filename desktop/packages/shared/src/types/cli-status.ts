// CLI Status Protocol types for Soulidity Desktop Companion
// Shared between Electron app, Claude Code hook, and Codex hook

export type CliAgentStatus =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'needs-attention'
  | 'completed'
  | 'error'

export interface AgentSession {
  sessionId: string
  clientType: 'claude-code' | 'codex' | 'custom'
  status: CliAgentStatus
  workingDirectory?: string
  sessionTitle?: string
  currentAction?: {
    tool?: string
    details?: string
    timestamp: number
  }
  needsAttention?: string
  startedAt: number
  lastUpdated: number
  endedAt?: number
}

export interface AgentStatusFile {
  version: 1
  lastUpdated: number
  sessions: Record<string, AgentSession>
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'idle',
  'thinking',
  'working',
  'needs-attention',
  'completed',
  'error',
])

const VALID_CLIENT_TYPES: ReadonlySet<string> = new Set([
  'claude-code',
  'codex',
  'custom',
])

/**
 * Parse and validate an AgentStatusFile from raw JSON string.
 * Returns null on any error (malformed JSON, wrong version, invalid sessions).
 */
export function parseAgentStatusFile(raw: string): AgentStatusFile | null {
  try {
    const parsed = JSON.parse(raw)

    if (typeof parsed !== 'object' || parsed === null) return null
    if (parsed.version !== 1) return null
    if (typeof parsed.lastUpdated !== 'number') return null
    if (typeof parsed.sessions !== 'object' || parsed.sessions === null) return null

    // Validate each session
    for (const [key, session] of Object.entries(parsed.sessions)) {
      if (!isValidSession(session)) return null
    }

    return parsed as AgentStatusFile
  } catch {
    return null
  }
}

function isValidSession(s: unknown): s is AgentSession {
  if (typeof s !== 'object' || s === null) return false
  const session = s as Record<string, unknown>

  if (typeof session.sessionId !== 'string') return false
  if (!VALID_CLIENT_TYPES.has(session.clientType as string)) return false
  if (!VALID_STATUSES.has(session.status as string)) return false
  if (typeof session.startedAt !== 'number') return false
  if (typeof session.lastUpdated !== 'number') return false

  // Optional fields
  if (session.workingDirectory !== undefined && typeof session.workingDirectory !== 'string') return false
  if (session.sessionTitle !== undefined && typeof session.sessionTitle !== 'string') return false
  if (session.endedAt !== undefined && typeof session.endedAt !== 'number') return false
  if (session.needsAttention !== undefined && typeof session.needsAttention !== 'string') return false

  if (session.currentAction !== undefined) {
    if (typeof session.currentAction !== 'object' || session.currentAction === null) return false
    const action = session.currentAction as Record<string, unknown>
    if (typeof action.timestamp !== 'number') return false
    if (action.tool !== undefined && typeof action.tool !== 'string') return false
    if (action.details !== undefined && typeof action.details !== 'string') return false
  }

  return true
}

/**
 * Derive aggregate status from the status file.
 * Returns the status of the most-recently-updated non-ended session,
 * or 'idle' if all sessions are ended.
 */
export function deriveAggregateStatus(file: AgentStatusFile): CliAgentStatus {
  let latest: AgentSession | null = null

  for (const session of Object.values(file.sessions)) {
    // Skip ended sessions
    if (session.endedAt !== undefined) continue

    if (latest === null || session.lastUpdated > latest.lastUpdated) {
      latest = session
    }
  }

  return latest ? latest.status : 'idle'
}
