import {
  deduplicateAgentSessions,
  type AgentSession,
  type AgentStatusFile,
} from './cli-status'

export type PetTaskAgent = AgentSession['clientType'] | 'claude' | 'codex'

export interface PetTaskSummary {
  agent: PetTaskAgent
  sessionId?: string
  sessionTitle?: string
  currentAction?: string
  workingDirectory?: string
  timestamp: number
}

export type PetAgentEventType =
  | 'agent-active'
  | 'agent-idle'
  | 'task-complete'
  | 'task-error'
  | 'needs-attention'

export interface PetAgentEvent {
  type: PetAgentEventType
  task?: PetTaskSummary
  message?: string
  timestamp?: number
}

export type PetUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface PetUpdateStatus {
  state: PetUpdateState
  version?: string
  progress?: number
  error?: string
}

export interface PetTaskOptions {
  now?: number
  terminalGraceMs?: number
}

function isVisibleSession(
  session: AgentSession,
  now: number,
  terminalGraceMs: number,
): boolean {
  return session.endedAt === undefined
    || (terminalGraceMs > 0 && (now - session.endedAt) < terminalGraceMs)
}

function isPetVisibleStatus(status: AgentSession['status']): boolean {
  return status === 'thinking' || status === 'working' || status === 'needs-attention'
}

function formatCurrentAction(session: AgentSession): string | undefined {
  if (session.status === 'needs-attention' && session.needsAttention) {
    return session.needsAttention
  }

  const tool = session.currentAction?.tool?.trim()
  const details = session.currentAction?.details?.trim()

  if (tool && details) return `${tool}: ${details}`
  if (tool) return tool
  if (details) return details

  return undefined
}

export function toPetTaskSummary(session: AgentSession): PetTaskSummary {
  return {
    agent: session.clientType,
    sessionId: session.sessionId,
    sessionTitle: session.sessionTitle,
    currentAction: formatCurrentAction(session),
    workingDirectory: session.workingDirectory,
    timestamp: session.lastUpdated,
  }
}

export function getVisiblePetTasks(
  file: AgentStatusFile | null,
  options: PetTaskOptions = {},
): PetTaskSummary[] {
  if (!file) return []

  const now = options.now ?? Date.now()
  const terminalGraceMs = options.terminalGraceMs ?? 0

  return Object.values(deduplicateAgentSessions(file.sessions))
    .filter((session) => isVisibleSession(session, now, terminalGraceMs) && isPetVisibleStatus(session.status))
    .map((session) => toPetTaskSummary(session))
    .sort((a, b) => b.timestamp - a.timestamp)
}

export function derivePetAgentEvents(
  previous: AgentStatusFile | null,
  next: AgentStatusFile | null,
  options: PetTaskOptions = {},
): PetAgentEvent[] {
  if (!next) return []

  const now = options.now ?? Date.now()
  const terminalGraceMs = options.terminalGraceMs ?? 0
  const previousSessions = previous ? deduplicateAgentSessions(previous.sessions) : {}
  const nextSessions = deduplicateAgentSessions(next.sessions)
  const events: PetAgentEvent[] = []

  for (const [sessionId, session] of Object.entries(nextSessions)) {
    if (!isVisibleSession(session, now, terminalGraceMs)) continue
    if (session.status !== 'thinking' && session.status !== 'working') continue

    const previousSession = previousSessions[sessionId]
    const wasVisible = previousSession
      ? isVisibleSession(previousSession, now, terminalGraceMs) && isPetVisibleStatus(previousSession.status)
      : false

    if (!wasVisible || previousSession?.status !== session.status) {
      events.push({
        type: 'agent-active',
        task: toPetTaskSummary(session),
      })
    }
  }

  for (const [sessionId, session] of Object.entries(nextSessions)) {
    if (!isVisibleSession(session, now, terminalGraceMs)) continue
    if (session.status !== 'needs-attention') continue

    const previousSession = previousSessions[sessionId]
    const becameAttention = !previousSession
      || previousSession.status !== 'needs-attention'
      || previousSession.needsAttention !== session.needsAttention

    if (becameAttention) {
      events.push({
        type: 'needs-attention',
        message: session.needsAttention,
        task: toPetTaskSummary(session),
      })
    }
  }

  const previousTasks = getVisiblePetTasks(previous, { now, terminalGraceMs })
  const nextTasks = getVisiblePetTasks(next, { now, terminalGraceMs })
  if (previousTasks.length > 0 && nextTasks.length === 0) {
    events.push({
      type: 'agent-idle',
      timestamp: next.lastUpdated || now,
    })
  }

  return events
}
