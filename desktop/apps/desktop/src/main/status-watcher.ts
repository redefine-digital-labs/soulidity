import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { BrowserWindow } from 'electron'
import { watch as chokidarWatch, type FSWatcher as ChokidarWatcher } from 'chokidar'
import {
  createAgentStatusSignature,
  deduplicateAgentSessions,
  parseAgentStatusFile,
  type AgentStatusFile,
} from '@soulidity/shared'

const SOULIDITY_DIR = path.join(os.homedir(), '.soulidity')
const STATUS_FILE = path.join(SOULIDITY_DIR, 'agent-status.json')

let watcher: ChokidarWatcher | null = null
let currentStatus: AgentStatusFile | null = null
let currentStatusSignature: string | null = null

function ensureDir() {
  fs.mkdirSync(SOULIDITY_DIR, { recursive: true })
}

function readCurrent(): AgentStatusFile | null {
  try {
    const raw = fs.readFileSync(STATUS_FILE, 'utf-8')
    return parseAgentStatusFile(raw)
  } catch {
    return null
  }
}

function sanitizeStatus(status: AgentStatusFile | null): AgentStatusFile | null {
  if (!status) return null
  return {
    ...status,
    sessions: deduplicateAgentSessions(status.sessions),
  }
}

function broadcastToWindows(status: AgentStatusFile) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('agent-status-changed', status)
  }
}

export function publishAgentStatus(
  status: AgentStatusFile | null,
  options?: { broadcast?: (status: AgentStatusFile) => void },
): void {
  const sanitized = sanitizeStatus(status)
  if (!sanitized) return

  const nextSignature = createAgentStatusSignature(sanitized)
  currentStatus = sanitized

  if (currentStatusSignature === nextSignature) return

  currentStatusSignature = nextSignature
  ;(options?.broadcast ?? broadcastToWindows)(sanitized)
}

export function getCurrentAgentStatus(): AgentStatusFile | null {
  return sanitizeStatus(currentStatus)
}

export function startStatusWatcher(onStatusChanged?: (status: AgentStatusFile) => void) {
  ensureDir()
  currentStatus = sanitizeStatus(readCurrent())
  currentStatusSignature = currentStatus ? createAgentStatusSignature(currentStatus) : null
  if (currentStatus) {
    onStatusChanged?.(currentStatus)
  }

  try {
    watcher = chokidarWatch(STATUS_FILE, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100 },
    })
    const handleFileUpdate = () => {
      const parsed = sanitizeStatus(readCurrent())
      if (!parsed) return

      const nextSignature = createAgentStatusSignature(parsed)
      currentStatus = parsed
      if (currentStatusSignature === nextSignature) return

      currentStatusSignature = nextSignature
      if (onStatusChanged) onStatusChanged(parsed)
      else broadcastToWindows(parsed)
    }
    watcher.on('add', handleFileUpdate)
    watcher.on('change', handleFileUpdate)
  } catch (err) {
    console.warn('[status-watcher] Failed to start:', err)
  }
}

export function stopStatusWatcher() {
  if (watcher) {
    watcher.close()
    watcher = null
  }
}
