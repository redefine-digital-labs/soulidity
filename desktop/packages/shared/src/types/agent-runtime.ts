import {
  deriveAggregateStatus,
  type AgentSession,
  type AgentStatusFile,
  type CliAgentStatus,
} from './cli-status'

export type SupportedAgentSource =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'cursor'
  | 'trae'
  | 'traecn'
  | 'qoder'
  | 'droid'
  | 'factory'
  | 'codebuddy'
  | 'codybuddycn'
  | 'stepfun'
  | 'copilot'
  | 'kimi'
  | 'opencode'
  | 'antigravity'
  | 'workbuddy'
  | 'hermes'
  | 'custom'

export type RuntimeStatus =
  | 'idle'
  | 'processing'
  | 'running'
  | 'waiting-approval'
  | 'waiting-question'
  | 'completed'
  | 'error'

export interface ToolHistoryEntry {
  tool: string
  description?: string
  timestamp: number
  success?: boolean
}

export interface RecentMessage {
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp: number
}

export interface RuntimeSession {
  sessionId: string
  taskId?: string
  source: SupportedAgentSource
  clientType: AgentSession['clientType']
  status: RuntimeStatus
  startedAt: number
  lastUpdated: number
  endedAt?: number
  workingDirectory?: string
  sessionTitle?: string
  currentTool?: string
  toolDescription?: string
  recentMessages: RecentMessage[]
  toolHistory: ToolHistoryEntry[]
  model?: string
  permissionMode?: string
  cliPid?: number
  transportSource?: 'socket' | 'file' | 'monitor' | 'task-executor'
}

export interface PendingPermission {
  requestId: string
  sessionId: string
  taskId?: string
  source: SupportedAgentSource
  toolName: string
  toolInput?: Record<string, unknown>
  createdAt: number
  options?: {
    allowAlways?: boolean
  }
}

export interface PendingQuestion {
  requestId: string
  sessionId: string
  taskId?: string
  source: SupportedAgentSource
  kind: 'question' | 'ask-user'
  question: string
  options?: string[]
  descriptions?: string[]
  createdAt: number
}

export interface HookInstallStatus {
  source: SupportedAgentSource
  label: string
  detected: boolean
  installed: boolean
  healthy: boolean
  configPath?: string
  error?: string
}

export interface TransportStatus {
  status: 'disabled' | 'starting' | 'ready' | 'error'
  mode: 'unix-socket' | 'named-pipe' | 'disabled'
  endpoint?: string
  lastError?: string
  updatedAt?: number
}

export interface AgentRuntimeSnapshot {
  version: 1
  lastUpdated: number
  transport: TransportStatus
  sessions: Record<string, RuntimeSession>
  pendingPermissions: PendingPermission[]
  pendingQuestions: PendingQuestion[]
  hooks: HookInstallStatus[]
}

export function isAgentRuntimeSnapshot(value: unknown): value is AgentRuntimeSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const snapshot = value as Record<string, unknown>
  return snapshot.version === 1
    && typeof snapshot.lastUpdated === 'number'
    && typeof snapshot.sessions === 'object'
    && snapshot.sessions !== null
    && Array.isArray(snapshot.pendingPermissions)
    && Array.isArray(snapshot.pendingQuestions)
    && typeof snapshot.transport === 'object'
    && snapshot.transport !== null
}

export function runtimeStatusToCliStatus(status: RuntimeStatus): CliAgentStatus {
  switch (status) {
    case 'processing':
      return 'thinking'
    case 'running':
      return 'working'
    case 'waiting-approval':
    case 'waiting-question':
      return 'needs-attention'
    case 'completed':
      return 'completed'
    case 'error':
      return 'error'
    case 'idle':
    default:
      return 'idle'
  }
}

function buildNeedsAttentionMessage(
  session: RuntimeSession,
  snapshot: AgentRuntimeSnapshot,
): string | undefined {
  if (session.status === 'waiting-question') {
    return snapshot.pendingQuestions.find((item) => item.sessionId === session.sessionId)?.question
  }

  if (session.status === 'waiting-approval') {
    const pending = snapshot.pendingPermissions.find((item) => item.sessionId === session.sessionId)
    if (pending?.toolName) return `Permission required: ${pending.toolName}`
    if (session.currentTool) return `Permission required: ${session.currentTool}`
  }

  return undefined
}

function toLegacyCurrentAction(session: RuntimeSession): AgentSession['currentAction'] | undefined {
  if (!session.currentTool && !session.toolDescription) return undefined

  return {
    tool: session.currentTool,
    details: session.toolDescription,
    timestamp: session.lastUpdated,
  }
}

export function toAgentStatusFile(snapshot: AgentRuntimeSnapshot): AgentStatusFile {
  const sessions: Record<string, AgentSession> = {}

  for (const [sessionId, session] of Object.entries(snapshot.sessions)) {
    sessions[sessionId] = {
      sessionId: session.sessionId,
      taskId: session.taskId,
      clientType: session.clientType,
      status: runtimeStatusToCliStatus(session.status),
      source: session.transportSource === 'monitor' ? 'monitor' : 'hook',
      workingDirectory: session.workingDirectory,
      sessionTitle: session.sessionTitle,
      currentAction: toLegacyCurrentAction(session),
      needsAttention: buildNeedsAttentionMessage(session, snapshot),
      startedAt: session.startedAt,
      lastUpdated: session.lastUpdated,
      endedAt: session.endedAt,
    }
  }

  return {
    version: 1,
    lastUpdated: snapshot.lastUpdated,
    sessions,
  }
}

export function deriveAggregateRuntimeCliStatus(
  snapshot: AgentRuntimeSnapshot,
  options: { now?: number; terminalGraceMs?: number } = {},
): CliAgentStatus {
  return deriveAggregateStatus(toAgentStatusFile(snapshot), options)
}
