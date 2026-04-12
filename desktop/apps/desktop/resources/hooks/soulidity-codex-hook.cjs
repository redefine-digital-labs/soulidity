// Soulidity Desktop Companion — Codex Hook Adapter
// Zero-dependency Node.js script that reads Codex notify events
// and updates ~/.soulidity/agent-status.json with the current agent status.

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const STATUS_FILE_NAME = 'agent-status.json'
const SOULIDITY_DIR_NAME = '.soulidity'
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours
const MAX_TITLE_LENGTH = 120

/**
 * Read the current status file, returning a valid structure or a fresh default.
 */
function readStatusFile(statusDir) {
  const filePath = path.join(statusDir, STATUS_FILE_NAME)
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && parsed.version === 1 && typeof parsed.sessions === 'object') {
      return parsed
    }
  } catch {
    // File doesn't exist or is corrupted — start fresh
  }
  return { version: 1, lastUpdated: Date.now(), sessions: {} }
}

/**
 * Atomically write the status file (write .tmp then rename).
 */
function writeStatusFile(statusDir, data) {
  fs.mkdirSync(statusDir, { recursive: true })
  const filePath = path.join(statusDir, STATUS_FILE_NAME)
  const tmpPath = filePath + '.tmp'
  data.lastUpdated = Date.now()
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

/**
 * Remove sessions older than 24 hours.
 */
function cleanupOldSessions(data) {
  const now = Date.now()
  for (const [id, session] of Object.entries(data.sessions)) {
    if (now - session.lastUpdated > SESSION_MAX_AGE_MS) {
      delete data.sessions[id]
    }
  }
}

/**
 * Extract session title from input-messages — first user message content, max 120 chars.
 */
function extractSessionTitle(input) {
  const messages = input['input-messages'] || input.input_messages
  if (!Array.isArray(messages)) return undefined

  for (const msg of messages) {
    if (msg.role === 'user' && typeof msg.content === 'string') {
      const content = msg.content.trim()
      if (content.length > MAX_TITLE_LENGTH) {
        return content.slice(0, MAX_TITLE_LENGTH)
      }
      return content || undefined
    }
  }
  return undefined
}

/**
 * Map Codex event type to CliAgentStatus.
 */
function mapEventToStatus(eventType) {
  switch (eventType) {
    case 'agent-turn-complete':
      return 'completed'
    case 'agent-turn-start':
      return 'working'
    case 'agent-error':
      return 'error'
    default:
      return 'working'
  }
}

/**
 * Process a single Codex notify event.
 * @param {object} input - The Codex event JSON
 * @param {string} [dir] - Override for the status directory (for testing)
 * @returns {object} The updated status file data
 */
function processCodexEvent(input, dir) {
  const statusDir = dir || path.join(os.homedir(), SOULIDITY_DIR_NAME)
  const data = readStatusFile(statusDir)
  cleanupOldSessions(data)

  const eventType = input.type || input.event
  const sessionId = input.session_id || input.id || 'codex-' + Date.now()
  const now = Date.now()

  if (!data.sessions[sessionId]) {
    data.sessions[sessionId] = {
      sessionId,
      clientType: 'codex',
      status: 'idle',
      startedAt: now,
      lastUpdated: now,
    }
  }

  const session = data.sessions[sessionId]
  session.status = mapEventToStatus(eventType)
  session.lastUpdated = now

  // New turn in same session: clear previous endedAt so useCliStatus shows it as active
  if (eventType === 'agent-turn-start') {
    delete session.endedAt
  }

  // Terminal events: mark session as ended so useCliStatus filters it out
  if (eventType === 'agent-turn-complete' || eventType === 'agent-error') {
    session.endedAt = now
  }

  // Extract session title from first user message
  const title = extractSessionTitle(input)
  if (title) {
    session.sessionTitle = title
  }

  writeStatusFile(statusDir, data)
  return data
}

// When run as a script, read from argv[2] or stdin
if (require.main === module) {
  // Try argv[2] first (Codex passes JSON as argument)
  if (process.argv[2]) {
    try {
      const input = JSON.parse(process.argv[2])
      processCodexEvent(input)
    } catch (err) {
      process.stderr.write(`soulidity-codex-hook: ${err.message}\n`)
      process.exit(1)
    }
  } else {
    // Fall back to stdin
    let chunks = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => { chunks += chunk })
    process.stdin.on('end', () => {
      try {
        const input = JSON.parse(chunks)
        processCodexEvent(input)
      } catch (err) {
        process.stderr.write(`soulidity-codex-hook: ${err.message}\n`)
        process.exit(1)
      }
    })
  }
}

module.exports = { processCodexEvent }
