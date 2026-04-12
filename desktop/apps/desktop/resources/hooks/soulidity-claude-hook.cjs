// Soulidity Desktop Companion — Claude Code Hook Adapter
// Zero-dependency Node.js script that reads Claude Code hook events from stdin
// and updates ~/.soulidity/agent-status.json with the current agent status.

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const STATUS_FILE_NAME = 'agent-status.json'
const SOULIDITY_DIR_NAME = '.soulidity'
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

// Tools that trigger needs-attention status
const ATTENTION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])

/**
 * Extract human-readable details from tool_input.
 */
function extractToolDetails(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return undefined

  // file_path → basename
  if (typeof toolInput.file_path === 'string') {
    return path.basename(toolInput.file_path)
  }
  // command → first 60 chars
  if (typeof toolInput.command === 'string') {
    const cmd = toolInput.command
    return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd
  }
  // pattern (grep/search)
  if (typeof toolInput.pattern === 'string') {
    return toolInput.pattern
  }

  return undefined
}

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
 * Get or create a session entry.
 */
function ensureSession(data, sessionId) {
  if (!data.sessions[sessionId]) {
    data.sessions[sessionId] = {
      sessionId,
      clientType: 'claude-code',
      status: 'idle',
      startedAt: Date.now(),
      lastUpdated: Date.now(),
    }
  }
  return data.sessions[sessionId]
}

/**
 * Process a single Claude Code hook event.
 * @param {object} input - The hook event JSON from stdin
 * @param {string} [dir] - Override for the status directory (for testing)
 * @returns {object} The updated status file data
 */
function processHookEvent(input, dir) {
  const statusDir = dir || path.join(os.homedir(), SOULIDITY_DIR_NAME)
  const data = readStatusFile(statusDir)
  cleanupOldSessions(data)

  const event = input.event
  const sessionId = input.session_id || 'unknown'
  const session = ensureSession(data, sessionId)
  const now = Date.now()

  switch (event) {
    case 'SessionStart': {
      session.status = 'idle'
      session.startedAt = now
      session.lastUpdated = now
      delete session.endedAt
      delete session.currentAction
      delete session.needsAttention
      if (input.cwd) {
        session.workingDirectory = input.cwd
      }
      break
    }

    case 'UserPromptSubmit': {
      session.status = 'working'
      session.lastUpdated = now
      delete session.currentAction
      delete session.needsAttention
      break
    }

    case 'PreToolUse': {
      const toolName = input.tool_name || input.tool
      const isAttention = ATTENTION_TOOLS.has(toolName)

      session.status = isAttention ? 'needs-attention' : 'working'
      if (isAttention && input.tool_input && typeof input.tool_input.question === 'string') {
        session.needsAttention = input.tool_input.question
      } else if (!isAttention) {
        delete session.needsAttention
      }

      const details = extractToolDetails(input.tool_input)
      session.currentAction = {
        tool: toolName,
        timestamp: now,
      }
      if (details) {
        session.currentAction.details = details
      }
      session.lastUpdated = now
      break
    }

    case 'PostToolUse': {
      session.status = 'working'
      session.lastUpdated = now
      delete session.currentAction
      break
    }

    case 'Stop': {
      session.status = 'completed'
      session.lastUpdated = now
      delete session.currentAction
      delete session.needsAttention
      break
    }

    case 'SessionEnd': {
      session.status = 'idle'
      session.endedAt = now
      session.lastUpdated = now
      break
    }

    default:
      // Unknown event — just update timestamp
      session.lastUpdated = now
      break
  }

  writeStatusFile(statusDir, data)
  return data
}

// When run as a script, read from stdin
if (require.main === module) {
  let chunks = ''
  process.stdin.setEncoding('utf-8')
  process.stdin.on('data', (chunk) => { chunks += chunk })
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(chunks)
      processHookEvent(input)
    } catch (err) {
      process.stderr.write(`soulidity-claude-hook: ${err.message}\n`)
      process.exit(1)
    }
  })
}

module.exports = { processHookEvent }
