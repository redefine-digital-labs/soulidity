import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

// Import the CommonJS module via createRequire (root package.json is "type": "module")
const require_ = createRequire(import.meta.url)
const { processCodexEvent } = require_('../../desktop/apps/desktop/resources/hooks/soulidity-codex-hook.cjs')

describe('soulidity-codex-hook', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-codex-hook-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function readStatus() {
    const raw = fs.readFileSync(path.join(tmpDir, 'agent-status.json'), 'utf-8')
    return JSON.parse(raw)
  }

  it('agent-turn-complete maps to completed with clientType=codex', () => {
    processCodexEvent(
      {
        type: 'agent-turn-complete',
        session_id: 'codex-1',
        'input-messages': [
          { role: 'user', content: 'Fix the login bug' },
        ],
      },
      tmpDir,
    )

    const data = readStatus()
    expect(data.version).toBe(1)
    const session = data.sessions['codex-1']
    expect(session).toBeDefined()
    expect(session.clientType).toBe('codex')
    expect(session.status).toBe('completed')
    expect(typeof session.startedAt).toBe('number')
    expect(typeof session.lastUpdated).toBe('number')
  })

  it('extracts session title from input-messages', () => {
    processCodexEvent(
      {
        type: 'agent-turn-complete',
        session_id: 'codex-2',
        'input-messages': [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Refactor the authentication module' },
        ],
      },
      tmpDir,
    )

    const session = readStatus().sessions['codex-2']
    expect(session.sessionTitle).toBe('Refactor the authentication module')
  })

  it('truncates session title to 120 characters', () => {
    const longMessage = 'A'.repeat(200)
    processCodexEvent(
      {
        type: 'agent-turn-complete',
        session_id: 'codex-3',
        'input-messages': [
          { role: 'user', content: longMessage },
        ],
      },
      tmpDir,
    )

    const session = readStatus().sessions['codex-3']
    expect(session.sessionTitle).toHaveLength(120)
  })

  it('handles input_messages with underscore (alternative field name)', () => {
    processCodexEvent(
      {
        type: 'agent-turn-complete',
        session_id: 'codex-4',
        input_messages: [
          { role: 'user', content: 'Deploy to production' },
        ],
      },
      tmpDir,
    )

    const session = readStatus().sessions['codex-4']
    expect(session.sessionTitle).toBe('Deploy to production')
  })

  it('agent-turn-start maps to working', () => {
    processCodexEvent(
      {
        type: 'agent-turn-start',
        session_id: 'codex-5',
      },
      tmpDir,
    )

    const session = readStatus().sessions['codex-5']
    expect(session.status).toBe('working')
  })

  it('agent-error maps to error', () => {
    processCodexEvent(
      {
        type: 'agent-error',
        session_id: 'codex-6',
      },
      tmpDir,
    )

    const session = readStatus().sessions['codex-6']
    expect(session.status).toBe('error')
  })

  it('creates new session if not found', () => {
    processCodexEvent(
      {
        type: 'agent-turn-complete',
        session_id: 'new-session',
      },
      tmpDir,
    )

    const data = readStatus()
    expect(data.sessions['new-session']).toBeDefined()
    expect(data.sessions['new-session'].clientType).toBe('codex')
  })

  it('preserves existing sessions from other clients', () => {
    // Pre-seed a claude-code session
    const seedData = {
      version: 1,
      lastUpdated: Date.now(),
      sessions: {
        'claude-session': {
          sessionId: 'claude-session',
          clientType: 'claude-code',
          status: 'working',
          startedAt: Date.now(),
          lastUpdated: Date.now(),
        },
      },
    }
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(
      path.join(tmpDir, 'agent-status.json'),
      JSON.stringify(seedData),
    )

    processCodexEvent(
      {
        type: 'agent-turn-complete',
        session_id: 'codex-session',
      },
      tmpDir,
    )

    const data = readStatus()
    expect(data.sessions['claude-session']).toBeDefined()
    expect(data.sessions['claude-session'].clientType).toBe('claude-code')
    expect(data.sessions['codex-session']).toBeDefined()
    expect(data.sessions['codex-session'].clientType).toBe('codex')
  })
})
