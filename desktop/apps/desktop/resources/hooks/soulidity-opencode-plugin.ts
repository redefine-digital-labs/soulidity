// Soulidity Desktop Companion — OpenCode Plugin Adapter (Stub)
// Awaiting OpenCode API stabilization.
// Same pattern as soulidity-claude-hook.cjs / soulidity-codex-hook.cjs:
//   Receive OpenCode events → map to 6-state CliAgentStatus → atomic write to ~/.soulidity/agent-status.json
//
// Expected OpenCode event shape (TBD):
//   { type: 'message' | 'tool-invocation' | 'session-start' | 'session-end', sessionId: string, ... }
//
// Status mapping (TBD):
//   session-start    → 'working'
//   message          → 'working'
//   tool-invocation  → 'working'
//   session-end      → 'completed'
//   error            → 'error'
//   user-input-needed → 'needs-attention'
//
// Implementation will follow the same structure as the Codex hook:
//   1. Read ~/.soulidity/agent-status.json (or create fresh)
//   2. Cleanup sessions older than 24h
//   3. Map event to status, upsert session
//   4. Atomic write (tmp + rename)

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const STATUS_FILE_NAME = 'agent-status.json'
const SOULIDITY_DIR_NAME = '.soulidity'
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface StatusFile {
  version: 1
  lastUpdated: number
  sessions: Record<string, {
    sessionId: string
    clientType: 'opencode'
    status: string
    source: 'hook'
    startedAt: number
    lastUpdated: number
    endedAt?: number
    sessionTitle?: string
    workingDirectory?: string
  }>
}

function readStatusFile(statusDir: string): StatusFile {
  const filePath = path.join(statusDir, STATUS_FILE_NAME)
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed?.version === 1 && typeof parsed.sessions === 'object') {
      return parsed as StatusFile
    }
  } catch {
    // File doesn't exist or is corrupted
  }
  return { version: 1, lastUpdated: Date.now(), sessions: {} }
}

function writeStatusFile(statusDir: string, data: StatusFile): void {
  fs.mkdirSync(statusDir, { recursive: true })
  const filePath = path.join(statusDir, STATUS_FILE_NAME)
  const tmpPath = filePath + `.${process.pid}.tmp`
  data.lastUpdated = Date.now()
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

function cleanupOldSessions(data: StatusFile): void {
  const now = Date.now()
  for (const [id, session] of Object.entries(data.sessions)) {
    if (now - session.lastUpdated > SESSION_MAX_AGE_MS) {
      delete data.sessions[id]
    }
  }
}

type OpenCodeEventType = 'session-start' | 'message' | 'tool-invocation' | 'session-end' | 'error' | 'user-input-needed'

function mapEventToStatus(eventType: OpenCodeEventType): string {
  switch (eventType) {
    case 'session-start':
    case 'message':
    case 'tool-invocation':
      return 'working'
    case 'session-end':
      return 'completed'
    case 'error':
      return 'error'
    case 'user-input-needed':
      return 'needs-attention'
    default:
      return 'working'
  }
}

export function processOpenCodeEvent(
  input: { type?: string; sessionId?: string; cwd?: string; title?: string },
  dir?: string,
): StatusFile {
  const statusDir = dir || path.join(os.homedir(), SOULIDITY_DIR_NAME)
  const data = readStatusFile(statusDir)
  cleanupOldSessions(data)

  const eventType = (input.type ?? 'message') as OpenCodeEventType
  const sessionId = input.sessionId ?? `opencode-${Date.now()}`
  const now = Date.now()

  if (!data.sessions[sessionId]) {
    data.sessions[sessionId] = {
      sessionId,
      clientType: 'opencode',
      status: 'idle',
      source: 'hook',
      startedAt: now,
      lastUpdated: now,
    }
  }

  const session = data.sessions[sessionId]
  session.status = mapEventToStatus(eventType)
  session.lastUpdated = now

  if (eventType === 'session-start' || eventType === 'message' || eventType === 'tool-invocation') {
    delete session.endedAt
  }

  if (eventType === 'session-end' || eventType === 'error') {
    session.endedAt = now
  }

  if (input.cwd) {
    session.workingDirectory = input.cwd
  }

  if (input.title) {
    session.sessionTitle = input.title.slice(0, 120)
  }

  writeStatusFile(statusDir, data)
  return data
}
