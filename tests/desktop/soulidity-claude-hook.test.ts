import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

// Import the CommonJS module via createRequire (root package.json is "type": "module")
const require_ = createRequire(import.meta.url)
const { processHookEvent } = require_('../../desktop/apps/desktop/resources/hooks/soulidity-claude-hook.cjs')

describe('soulidity-claude-hook', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-claude-hook-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function readStatus() {
    const raw = fs.readFileSync(path.join(tmpDir, 'agent-status.json'), 'utf-8')
    return JSON.parse(raw)
  }

  it('SessionStart creates idle session with clientType=claude-code', () => {
    processHookEvent(
      {
        event: 'SessionStart',
        session_id: 'sess-abc',
        cwd: '/home/user/project',
      },
      tmpDir,
    )

    const data = readStatus()
    expect(data.version).toBe(1)
    const session = data.sessions['sess-abc']
    expect(session).toBeDefined()
    expect(session.clientType).toBe('claude-code')
    expect(session.status).toBe('idle')
    expect(session.workingDirectory).toBe('/home/user/project')
    expect(session.endedAt).toBeUndefined()
    expect(session.currentAction).toBeUndefined()
    expect(session.needsAttention).toBeUndefined()
  })

  it('PreToolUse sets working + currentAction with tool details (file_path)', () => {
    // Start session first
    processHookEvent({ event: 'SessionStart', session_id: 's1' }, tmpDir)

    processHookEvent(
      {
        event: 'PreToolUse',
        session_id: 's1',
        tool_name: 'Read',
        tool_input: { file_path: '/home/user/project/src/index.ts' },
      },
      tmpDir,
    )

    const session = readStatus().sessions['s1']
    expect(session.status).toBe('working')
    expect(session.currentAction).toBeDefined()
    expect(session.currentAction.tool).toBe('Read')
    expect(session.currentAction.details).toBe('index.ts')
    expect(typeof session.currentAction.timestamp).toBe('number')
  })

  it('PreToolUse extracts command details (first 60 chars)', () => {
    processHookEvent({ event: 'SessionStart', session_id: 's1' }, tmpDir)

    const longCmd = 'npm run build --mode production && npm run test -- --coverage --verbose'
    processHookEvent(
      {
        event: 'PreToolUse',
        session_id: 's1',
        tool_name: 'Bash',
        tool_input: { command: longCmd },
      },
      tmpDir,
    )

    const session = readStatus().sessions['s1']
    expect(session.currentAction.tool).toBe('Bash')
    expect(session.currentAction.details).toBe(longCmd.slice(0, 60) + '...')
  })

  it('PreToolUse extracts pattern details', () => {
    processHookEvent({ event: 'SessionStart', session_id: 's1' }, tmpDir)

    processHookEvent(
      {
        event: 'PreToolUse',
        session_id: 's1',
        tool_name: 'Grep',
        tool_input: { pattern: 'TODO|FIXME' },
      },
      tmpDir,
    )

    const session = readStatus().sessions['s1']
    expect(session.currentAction.details).toBe('TODO|FIXME')
  })

  it('AskUserQuestion triggers needs-attention', () => {
    processHookEvent({ event: 'SessionStart', session_id: 's1' }, tmpDir)

    processHookEvent(
      {
        event: 'PreToolUse',
        session_id: 's1',
        tool_name: 'AskUserQuestion',
        tool_input: { question: 'Should I proceed with the migration?' },
      },
      tmpDir,
    )

    const session = readStatus().sessions['s1']
    expect(session.status).toBe('needs-attention')
    expect(session.needsAttention).toBe('Should I proceed with the migration?')
  })

  it('ExitPlanMode triggers needs-attention', () => {
    processHookEvent({ event: 'SessionStart', session_id: 's1' }, tmpDir)

    processHookEvent(
      {
        event: 'PreToolUse',
        session_id: 's1',
        tool_name: 'ExitPlanMode',
        tool_input: {},
      },
      tmpDir,
    )

    const session = readStatus().sessions['s1']
    expect(session.status).toBe('needs-attention')
  })

  it('PostToolUse clears currentAction and sets working', () => {
    processHookEvent({ event: 'SessionStart', session_id: 's1' }, tmpDir)
    processHookEvent(
      {
        event: 'PreToolUse',
        session_id: 's1',
        tool_name: 'Read',
        tool_input: { file_path: '/tmp/x.ts' },
      },
      tmpDir,
    )

    // Verify currentAction exists
    expect(readStatus().sessions['s1'].currentAction).toBeDefined()

    processHookEvent({ event: 'PostToolUse', session_id: 's1' }, tmpDir)

    const session = readStatus().sessions['s1']
    expect(session.status).toBe('working')
    expect(session.currentAction).toBeUndefined()
  })

  it('Stop sets completed and clears action/attention', () => {
    processHookEvent({ event: 'SessionStart', session_id: 's1' }, tmpDir)
    processHookEvent(
      {
        event: 'PreToolUse',
        session_id: 's1',
        tool_name: 'AskUserQuestion',
        tool_input: { question: 'confirm?' },
      },
      tmpDir,
    )

    processHookEvent({ event: 'Stop', session_id: 's1' }, tmpDir)

    const session = readStatus().sessions['s1']
    expect(session.status).toBe('completed')
    expect(session.currentAction).toBeUndefined()
    expect(session.needsAttention).toBeUndefined()
  })

  it('SessionEnd sets idle with endedAt', () => {
    processHookEvent({ event: 'SessionStart', session_id: 's1' }, tmpDir)
    processHookEvent({ event: 'SessionEnd', session_id: 's1' }, tmpDir)

    const session = readStatus().sessions['s1']
    expect(session.status).toBe('idle')
    expect(typeof session.endedAt).toBe('number')
  })

  it('UserPromptSubmit sets working and clears action/attention', () => {
    processHookEvent({ event: 'SessionStart', session_id: 's1' }, tmpDir)
    processHookEvent(
      {
        event: 'PreToolUse',
        session_id: 's1',
        tool_name: 'AskUserQuestion',
        tool_input: { question: 'ready?' },
      },
      tmpDir,
    )

    processHookEvent({ event: 'UserPromptSubmit', session_id: 's1' }, tmpDir)

    const session = readStatus().sessions['s1']
    expect(session.status).toBe('working')
    expect(session.currentAction).toBeUndefined()
    expect(session.needsAttention).toBeUndefined()
  })

  it('cleans up sessions older than 24h', () => {
    // Create a stale session manually
    const staleData = {
      version: 1,
      lastUpdated: 0,
      sessions: {
        'old-session': {
          sessionId: 'old-session',
          clientType: 'claude-code',
          status: 'working',
          startedAt: 0,
          lastUpdated: 1, // very old
        },
      },
    }
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(
      path.join(tmpDir, 'agent-status.json'),
      JSON.stringify(staleData),
    )

    // Process a new event — should trigger cleanup
    processHookEvent({ event: 'SessionStart', session_id: 'new-session' }, tmpDir)

    const data = readStatus()
    expect(data.sessions['old-session']).toBeUndefined()
    expect(data.sessions['new-session']).toBeDefined()
  })

  it('handles multiple concurrent sessions', () => {
    processHookEvent({ event: 'SessionStart', session_id: 's1' }, tmpDir)
    processHookEvent({ event: 'SessionStart', session_id: 's2' }, tmpDir)
    processHookEvent(
      { event: 'PreToolUse', session_id: 's1', tool_name: 'Read', tool_input: {} },
      tmpDir,
    )

    const data = readStatus()
    expect(Object.keys(data.sessions)).toHaveLength(2)
    expect(data.sessions['s1'].status).toBe('working')
    expect(data.sessions['s2'].status).toBe('idle')
  })
})
