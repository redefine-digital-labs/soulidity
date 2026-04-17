// CLI Status Protocol types for Soulidity Desktop Companion
// Shared between Electron app, Claude Code hook, and Codex hook

export type CliAgentStatus =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'needs-attention'
  | 'completed'
  | 'error'

export const CLI_TERMINAL_GRACE_MS = 3000

const STATUS_PRIORITY: Record<CliAgentStatus, number> = {
  error: 5,
  'needs-attention': 4,
  working: 3,
  thinking: 2,
  completed: 1,
  idle: 0,
}

export interface AgentSession {
  sessionId: string
  taskId?: string
  clientType: 'claude-code' | 'codex' | 'opencode' | 'custom'
  status: CliAgentStatus
  /** 数据来源：hook 主动上报 or monitor 被动检测 */
  source?: 'hook' | 'monitor'
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

function normalizeCurrentActionForSignature(action: AgentSession['currentAction']) {
  if (!action) return null
  return {
    tool: action.tool ?? null,
    details: action.details ?? null,
    timestamp: action.timestamp,
  }
}

function normalizeSessionForSignature(session: AgentSession) {
  return {
    sessionId: session.sessionId,
    taskId: session.taskId ?? null,
    clientType: session.clientType,
    status: session.status,
    source: session.source ?? null,
    workingDirectory: session.workingDirectory ?? null,
    sessionTitle: session.sessionTitle ?? null,
    currentAction: normalizeCurrentActionForSignature(session.currentAction),
    needsAttention: session.needsAttention ?? null,
    startedAt: session.startedAt,
    lastUpdated: session.lastUpdated,
    endedAt: session.endedAt ?? null,
  }
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
  'opencode',
  'custom',
])

const VALID_SOURCES: ReadonlySet<string> = new Set([
  'hook',
  'monitor',
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
  if (session.taskId !== undefined && typeof session.taskId !== 'string') return false
  if (session.workingDirectory !== undefined && typeof session.workingDirectory !== 'string') return false
  if (session.sessionTitle !== undefined && typeof session.sessionTitle !== 'string') return false
  if (session.endedAt !== undefined && typeof session.endedAt !== 'number') return false
  if (session.needsAttention !== undefined && typeof session.needsAttention !== 'string') return false

  if (session.source !== undefined && !VALID_SOURCES.has(session.source as string)) return false

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
 * Filter out monitor sessions for clientTypes that also have a hook session.
 * Hook sessions are more accurate (event-driven), so they take priority.
 */
export function deduplicateAgentSessions(
  sessions: Record<string, AgentSession>,
): Record<string, AgentSession> {
  const hookCovered = new Set<string>()
  for (const session of Object.values(sessions)) {
    // Only suppress monitor sessions when there is a currently-active hook session.
    // Ended hook sessions must not hide live monitor sessions.
    const isHookSource = session.source === 'hook' || session.source === undefined
    if (isHookSource && session.endedAt === undefined) {
      hookCovered.add(session.clientType)
    }
  }

  if (hookCovered.size === 0) return sessions

  const deduped: Record<string, AgentSession> = {}
  for (const [id, session] of Object.entries(sessions)) {
    if (session.source === 'monitor' && hookCovered.has(session.clientType)) {
      continue
    }
    deduped[id] = session
  }

  return deduped
}

/**
 * Build a stable signature for the status payload that downstream desktop
 * consumers actually react to. Root-level snapshot timestamps are intentionally
 * excluded so repeated no-op publications do not rebroadcast identical state.
 */
export function createAgentStatusSignature(file: AgentStatusFile): string {
  const sessions = Object.entries(deduplicateAgentSessions(file.sessions))
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([sessionId, session]) => [sessionId, normalizeSessionForSignature(session)])

  return JSON.stringify({
    version: file.version,
    sessions,
  })
}

/**
 * Derive aggregate status from the status file.
 * Returns the highest-priority visible session status, or 'idle' when none is visible.
 */
export interface AgentConfig {
  name: string
  displayName: string
  clientType: AgentSession['clientType']
  processPatterns: string[]
  logPaths: string[]
  filePatterns: string[]
}

/**
 * Derive aggregate status from the status file.
 * Returns the highest-priority visible session status, or 'idle' when none is visible.
 */
export function deriveAggregateStatus(
  file: AgentStatusFile,
  options: { now?: number; terminalGraceMs?: number } = {},
): CliAgentStatus {
  const now = options.now ?? Date.now()
  const terminalGraceMs = options.terminalGraceMs ?? 0

  const deduped = Object.values(deduplicateAgentSessions(file.sessions))

  // Partition into active (non-ended) and grace-window terminal sessions.
  // Active sessions always take priority so a recent error/completion
  // cannot mask a currently-running session.
  const activeSessions: AgentSession[] = []
  const graceSessions: AgentSession[] = []

  for (const session of deduped) {
    if (session.endedAt === undefined) {
      activeSessions.push(session)
    } else if (terminalGraceMs > 0 && (now - session.endedAt) < terminalGraceMs) {
      graceSessions.push(session)
    }
  }

  const candidates = activeSessions.length > 0 ? activeSessions : graceSessions

  let current: AgentSession | null = null
  for (const session of candidates) {
    if (!current) {
      current = session
      continue
    }

    const priorityDelta = STATUS_PRIORITY[session.status] - STATUS_PRIORITY[current.status]
    if (priorityDelta > 0 || (priorityDelta === 0 && session.lastUpdated > current.lastUpdated)) {
      current = session
    }
  }

  return current ? current.status : 'idle'
}
