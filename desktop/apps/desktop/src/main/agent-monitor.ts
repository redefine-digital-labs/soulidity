/**
 * AgentMonitor — Passive detection of CLI agent processes.
 *
 * Four sub-components:
 *   ProcessProbe  — polls `pgrep` every 5 s to detect running agent CLIs
 *   LogWatcher    — tails ~/.claude/projects/ JSONL logs for granular status
 *   HookDetector  — checks if hooks are already installed (avoid duplicate sessions)
 *   File I/O      — reads/writes ~/.soulidity/agent-status.json with atomic rename
 *
 * All sessions written by the monitor carry `source: 'monitor'`.
 * The existing status-watcher picks up file changes automatically.
 */

import { exec } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { AgentSession, AgentStatusFile, CliAgentStatus } from '@soulidity/shared'
import type { AgentConfig } from '@soulidity/shared'

// ── 声明式 Agent 配置 ──────────────────────────────────────
const AGENT_CONFIGS: readonly AgentConfig[] = [
  {
    name: 'claude-code', displayName: 'Claude Code',
    clientType: 'claude-code',
    processPatterns: ['claude-code', '@anthropic-ai/claude-code', 'bin/claude'],
    logPaths: [path.join(os.homedir(), '.claude', 'projects')],
    filePatterns: ['**/*.jsonl'],
  },
  {
    name: 'codex', displayName: 'Codex',
    clientType: 'codex',
    processPatterns: ['codex', '@openai/codex'],
    logPaths: [path.join(os.homedir(), '.codex', 'sessions')],
    filePatterns: ['**/*.jsonl'],
  },
  {
    name: 'opencode', displayName: 'OpenCode',
    clientType: 'opencode',
    processPatterns: ['opencode', '@sst/opencode'],
    logPaths: [
      path.join(os.homedir(), '.local', 'share', 'opencode', 'storage', 'message'),
      path.join(os.homedir(), '.local', 'share', 'opencode', 'storage', 'part'),
    ],
    filePatterns: ['**/*.jsonl', '**/*.json'],
  },
]

// ── Constants ────────────────────────────────────────────────

const SOULIDITY_DIR = path.join(os.homedir(), '.soulidity')
const STATUS_FILE = path.join(SOULIDITY_DIR, 'agent-status.json')
const PROBE_INTERVAL_MS = 5_000
const HOOK_CHECK_INTERVAL_MS = 60_000
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours
/** JSONL files not modified for this long are considered stale */
const LOG_STALE_MS = 30_000

type ClientType = AgentSession['clientType']

// ── State ────────────────────────────────────────────────────

let probeTimer: ReturnType<typeof setInterval> | null = null
let hookCheckTimer: ReturnType<typeof setInterval> | null = null

/** PIDs we are currently tracking, keyed by sessionId */
const trackedPids = new Map<string, { pid: number; clientType: ClientType }>()

/** clientTypes that have hooks installed — skip monitor for these */
let hookCoveredTypes = new Set<ClientType>()

// ── HookDetector ─────────────────────────────────────────────

/**
 * Check if the Claude Code hook is installed by reading ~/.claude/settings.json.
 * Returns true if any hook command contains "soulidity".
 */
function isClaudeHookInstalled(): boolean {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
    const raw = fs.readFileSync(settingsPath, 'utf-8')
    const settings = JSON.parse(raw)

    // settings.hooks is an object with event keys, each containing an array of hook configs
    if (typeof settings?.hooks !== 'object' || settings.hooks === null) return false

    for (const hooks of Object.values(settings.hooks)) {
      if (!Array.isArray(hooks)) continue
      for (const hook of hooks) {
        const cmd = typeof hook === 'string' ? hook : hook?.command
        if (typeof cmd === 'string' && cmd.toLowerCase().includes('soulidity')) {
          return true
        }
      }
    }
  } catch {
    // File doesn't exist or can't be parsed — assume no hook
  }
  return false
}

/**
 * Refresh the set of clientTypes that have hooks installed.
 * Currently only Claude Code hooks are detectable; Codex and OpenCode
 * don't have a standard hook config path, so they are never hook-covered.
 */
function refreshHookCoverage(): void {
  const covered = new Set<ClientType>()
  if (isClaudeHookInstalled()) {
    covered.add('claude-code')
  }
  // Future: add detection for codex/opencode hook configs here
  hookCoveredTypes = covered
}

// ── File I/O ─────────────────────────────────────────────────

function readStatusFile(): AgentStatusFile {
  try {
    const raw = fs.readFileSync(STATUS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed?.version === 1 && typeof parsed.sessions === 'object') {
      return parsed as AgentStatusFile
    }
  } catch {
    // Missing or corrupted — start fresh
  }
  return { version: 1, lastUpdated: Date.now(), sessions: {} }
}

/**
 * Atomic write: write to .tmp then rename.
 * Same pattern as the hook scripts to avoid partial reads.
 */
function writeStatusFile(data: AgentStatusFile): void {
  fs.mkdirSync(SOULIDITY_DIR, { recursive: true })
  const tmpPath = STATUS_FILE + '.tmp'
  data.lastUpdated = Date.now()
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmpPath, STATUS_FILE)
}

/** Remove monitor sessions older than 24 hours */
function cleanupOldMonitorSessions(data: AgentStatusFile): void {
  const now = Date.now()
  for (const [id, session] of Object.entries(data.sessions)) {
    if (session.source === 'monitor' && now - session.lastUpdated > SESSION_MAX_AGE_MS) {
      delete data.sessions[id]
    }
  }
}

// ── ProcessProbe ─────────────────────────────────────────────

interface DetectedProcess {
  pid: number
  clientType: ClientType
  workingDirectory?: string
}

/**
 * Build the platform-specific process detection command.
 * macOS/Linux: `pgrep -af <pattern>`
 * Windows: PowerShell CIM query matching the command line.
 */
function buildDetectCommand(pattern: string): string {
  if (process.platform === 'win32') {
    const escaped = pattern.replace(/'/g, "''")
    return `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${escaped}' } | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CommandLine }"`
  }
  return `pgrep -af "${pattern}"`
}

/** Return true if the output line is the detection command itself. */
function isSelfDetectionProcess(cmdLine: string): boolean {
  if (process.platform === 'win32') {
    return cmdLine.includes('Get-CimInstance')
  }
  return cmdLine.includes('pgrep')
}

/**
 * Detect running agent CLI processes using platform-appropriate commands.
 * Returns a promise that resolves with detected processes (never rejects).
 */
function detectProcesses(pattern: string, clientType: ClientType): Promise<DetectedProcess[]> {
  return new Promise((resolve) => {
    exec(buildDetectCommand(pattern), { timeout: 4_000 }, (err, stdout) => {
      // pgrep exits with code 1 when no matches — that's fine
      if (err || !stdout.trim()) {
        resolve([])
        return
      }

      const results: DetectedProcess[] = []
      for (const line of stdout.trim().split('\n')) {
        const match = line.match(/^\s*(\d+)\s+(.+)$/)
        if (!match) continue

        const pid = parseInt(match[1], 10)
        const cmdLine = match[2]

        // Skip the detection command itself
        if (isSelfDetectionProcess(cmdLine)) continue

        // Try to extract working directory from --cwd or -C flags
        let workingDirectory: string | undefined
        const cwdMatch = cmdLine.match(/(?:--cwd|-C)\s+(\S+)/)
        if (cwdMatch) {
          workingDirectory = cwdMatch[1]
        }

        results.push({ pid, clientType, workingDirectory })
      }
      resolve(results)
    })
  })
}

/** Build a session ID for monitor-created sessions */
function monitorSessionId(clientType: ClientType, pid: number): string {
  return `monitor-${clientType}-${pid}`
}

function logSessionId(claudeSessionId: string): string {
  return `monitor-log-${claudeSessionId}`
}

// ── LogWatcher ──────────────────────────────────────────────

/** Cached state per JSONL file */
interface LogFileState {
  filePath: string
  lastSize: number
  lastMtimeMs: number
}

/** Parsed JSONL entry (only fields we care about) */
interface LogEntry {
  type?: string
  subtype?: string
  sessionId?: string
  cwd?: string
}

const logFileStates = new Map<string, LogFileState>()

/**
 * Map JSONL log entry type to CLI agent status.
 * Returns null if the entry type doesn't map to a meaningful status change.
 */
function logEntryToStatus(entry: LogEntry): CliAgentStatus | null {
  const t = entry.type
  const sub = entry.subtype

  if (t === 'user') return 'working'
  if (t === 'assistant') return 'working'
  if (t === 'system' && sub === 'turn_duration') return 'completed'
  return null
}

/**
 * Find the most recently modified log files across all agent log directories.
 * Uses each AgentConfig's logPaths and filePatterns.
 * Returns at most 5 files, sorted by mtime desc.
 */
function findRecentLogFiles(): string[] {
  try {
    const files: { path: string; mtimeMs: number }[] = []
    const now = Date.now()

    for (const cfg of AGENT_CONFIGS) {
      // Build a set of file extensions to match from filePatterns (e.g. '**/*.jsonl' → '.jsonl')
      const extensions = cfg.filePatterns
        .map((p) => { const m = p.match(/\*\.(\w+)$/); return m ? `.${m[1]}` : null })
        .filter((e): e is string => e !== null)

      for (const logDir of cfg.logPaths) {
        if (!fs.existsSync(logDir)) continue

        const subdirs = fs.readdirSync(logDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => path.join(logDir, d.name))

        // Also scan the logDir itself (some agents store files directly)
        subdirs.push(logDir)

        for (const dir of subdirs) {
          try {
            const entries = fs.readdirSync(dir)
            for (const entry of entries) {
              if (!extensions.some((ext) => entry.endsWith(ext))) continue
              const filePath = path.join(dir, entry)
              try {
                const stat = fs.statSync(filePath)
                if (now - stat.mtimeMs < LOG_STALE_MS) {
                  files.push({ path: filePath, mtimeMs: stat.mtimeMs })
                }
              } catch { /* skip unreadable */ }
            }
          } catch { /* skip unreadable dir */ }
        }
      }
    }

    return files
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 5)
      .map((f) => f.path)
  } catch {
    return []
  }
}

/**
 * Read the last line of a file that was appended to since last check.
 * Uses size-based diff to only read new content.
 */
function readLogTail(filePath: string): LogEntry | null {
  try {
    const stat = fs.statSync(filePath)
    const state = logFileStates.get(filePath)

    if (state && stat.mtimeMs === state.lastMtimeMs) {
      return null // No change
    }

    // Read the last ~2KB for the latest entry
    const readSize = 2048
    const start = Math.max(0, stat.size - readSize)
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(Math.min(readSize, stat.size))
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)

    const text = buf.toString('utf-8')
    const lines = text.trim().split('\n')

    // Update cached state
    logFileStates.set(filePath, { filePath, lastSize: stat.size, lastMtimeMs: stat.mtimeMs })

    // Parse the last non-empty line
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line) continue
      try {
        return JSON.parse(line) as LogEntry
      } catch { /* malformed line, try previous */ }
    }
  } catch { /* file disappeared or unreadable */ }
  return null
}

/**
 * Run one LogWatcher cycle: find recent JSONL files, read tails, update sessions.
 * Returns session updates keyed by sessionId.
 */
function runLogWatch(): Map<string, { status: CliAgentStatus; cwd?: string; sessionId: string }> {
  const updates = new Map<string, { status: CliAgentStatus; cwd?: string; sessionId: string }>()

  const recentFiles = findRecentLogFiles()
  for (const filePath of recentFiles) {
    const entry = readLogTail(filePath)
    if (!entry) continue

    const status = logEntryToStatus(entry)
    if (!status) continue

    const sid = entry.sessionId
    if (!sid) continue

    updates.set(sid, { status, cwd: entry.cwd, sessionId: sid })
  }

  return updates
}

/**
 * Run one probe cycle: detect processes, upsert/mark-ended sessions.
 */
async function runProbe(): Promise<void> {
  try {
    // Run all pgrep calls in parallel across all agent configs
    const allDetected = (
      await Promise.all(
        AGENT_CONFIGS.flatMap((cfg) =>
          cfg.processPatterns.map((pattern) => detectProcesses(pattern, cfg.clientType))
        )
      )
    ).flat()

    // Build a set of currently-alive session IDs
    const aliveIds = new Set<string>()
    for (const proc of allDetected) {
      // Skip if hooks cover this clientType
      if (hookCoveredTypes.has(proc.clientType)) continue

      const sid = monitorSessionId(proc.clientType, proc.pid)
      aliveIds.add(sid)

      // Track for disappearance detection
      if (!trackedPids.has(sid)) {
        trackedPids.set(sid, { pid: proc.pid, clientType: proc.clientType })
      }
    }

    // Read existing file, merge changes
    const data = readStatusFile()
    cleanupOldMonitorSessions(data)

    const now = Date.now()
    let changed = false

    // Upsert alive monitor sessions
    for (const proc of allDetected) {
      if (hookCoveredTypes.has(proc.clientType)) continue

      const sid = monitorSessionId(proc.clientType, proc.pid)
      const existing = data.sessions[sid]

      if (existing) {
        // Already tracked — just refresh timestamp if still working
        if (existing.status !== 'working' || now - existing.lastUpdated > PROBE_INTERVAL_MS) {
          existing.status = 'working'
          existing.lastUpdated = now
          delete existing.endedAt
          if (proc.workingDirectory) {
            existing.workingDirectory = proc.workingDirectory
          }
          changed = true
        }
      } else {
        // New process detected
        data.sessions[sid] = {
          sessionId: sid,
          clientType: proc.clientType,
          status: 'working',
          source: 'monitor',
          startedAt: now,
          lastUpdated: now,
          ...(proc.workingDirectory ? { workingDirectory: proc.workingDirectory } : {}),
        }
        changed = true
      }
    }

    // Mark disappeared processes as idle
    for (const [sid, info] of trackedPids) {
      if (aliveIds.has(sid)) continue

      const session = data.sessions[sid]
      if (session && session.source === 'monitor' && !session.endedAt) {
        session.status = 'idle'
        session.endedAt = now
        session.lastUpdated = now
        changed = true
      }
      trackedPids.delete(sid)
    }

    // ── LogWatcher: enhance with JSONL-derived status ──
    if (!hookCoveredTypes.has('claude-code')) {
      const logUpdates = runLogWatch()
      for (const [claudeSid, update] of logUpdates) {
        const sid = logSessionId(claudeSid)

        const existing = data.sessions[sid]
        if (existing) {
          // Only update if status actually changed or enough time passed
          if (existing.status !== update.status || now - existing.lastUpdated > PROBE_INTERVAL_MS) {
            existing.status = update.status
            existing.lastUpdated = now
            if (update.status === 'completed') {
              existing.endedAt = now
            } else {
              delete existing.endedAt
            }
            if (update.cwd) existing.workingDirectory = update.cwd
            changed = true
          }
        } else {
          // New session from log — only create if actively working
          if (update.status === 'working') {
            data.sessions[sid] = {
              sessionId: sid,
              clientType: 'claude-code',
              status: update.status,
              source: 'monitor',
              startedAt: now,
              lastUpdated: now,
              ...(update.cwd ? { workingDirectory: update.cwd } : {}),
            }
            changed = true
          }
        }
      }

      // Mark log sessions as idle if their JSONL wasn't recently modified
      for (const [sid, session] of Object.entries(data.sessions)) {
        if (!sid.startsWith('monitor-log-')) continue
        if (session.source !== 'monitor') continue
        if (session.endedAt) continue

        const claudeSid = sid.replace('monitor-log-', '')
        if (!logUpdates.has(claudeSid) && now - session.lastUpdated > LOG_STALE_MS) {
          session.status = 'idle'
          session.endedAt = now
          session.lastUpdated = now
          changed = true
        }
      }
    }

    if (changed) {
      writeStatusFile(data)
    }
  } catch (err) {
    console.warn('[agent-monitor] probe error:', err)
  }
}

// ── Public API ───────────────────────────────────────────────

export function startAgentMonitor(): void {
  // Initial hook coverage check
  refreshHookCoverage()

  // Run first probe immediately
  runProbe()

  // Schedule recurring probes and hook checks
  probeTimer = setInterval(() => { runProbe() }, PROBE_INTERVAL_MS)
  hookCheckTimer = setInterval(refreshHookCoverage, HOOK_CHECK_INTERVAL_MS)

  console.log('[agent-monitor] started')
}

export function stopAgentMonitor(): void {
  if (probeTimer) {
    clearInterval(probeTimer)
    probeTimer = null
  }
  if (hookCheckTimer) {
    clearInterval(hookCheckTimer)
    hookCheckTimer = null
  }
  trackedPids.clear()
  logFileStates.clear()
  console.log('[agent-monitor] stopped')
}
