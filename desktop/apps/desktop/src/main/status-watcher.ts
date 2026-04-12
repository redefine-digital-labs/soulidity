import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { BrowserWindow } from 'electron'

const SOULIDITY_DIR = path.join(os.homedir(), '.soulidity')
const STATUS_FILE = path.join(SOULIDITY_DIR, 'agent-status.json')

let watcher: fs.FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let currentStatus: Record<string, unknown> | null = null

function ensureDir() {
  fs.mkdirSync(SOULIDITY_DIR, { recursive: true })
}

function readCurrent(): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(STATUS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed?.version === 1) return parsed
    return null
  } catch {
    return null
  }
}

function broadcastToWindows(status: Record<string, unknown>) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('agent-status-changed', status)
  }
}

export function getCurrentAgentStatus(): Record<string, unknown> | null {
  return currentStatus
}

export function startStatusWatcher() {
  ensureDir()
  currentStatus = readCurrent()

  try {
    watcher = fs.watch(SOULIDITY_DIR, (eventType, filename) => {
      if (filename !== 'agent-status.json') return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const parsed = readCurrent()
        if (parsed) {
          currentStatus = parsed
          broadcastToWindows(parsed)
        }
      }, 100)
    })
  } catch (err) {
    console.warn('[status-watcher] Failed to start:', err)
  }
}

export function stopStatusWatcher() {
  if (watcher) {
    watcher.close()
    watcher = null
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}
