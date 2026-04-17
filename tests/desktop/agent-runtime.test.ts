import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRuntimeController, buildPermissionResponse, createUnixSocketTransportServer } from '../../desktop/apps/desktop/src/main/agent-runtime'
import { toAgentStatusFile } from '../../desktop/packages/shared/src/types/agent-runtime'

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now()
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function connectAndCollect(socketPath: string, payload: string | Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let response = ''
    socket.setEncoding('utf8')
    socket.once('connect', () => {
      socket.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
    })
    socket.on('data', (chunk) => {
      response += chunk
    })
    socket.once('end', () => resolve(response))
    socket.once('error', reject)
  })
}

function connectAndDestroy(socketPath: string, payload: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    socket.once('connect', () => {
      socket.write(JSON.stringify(payload))
      socket.end()
      setTimeout(() => socket.destroy(), 25)
    })
    socket.once('close', () => resolve())
    socket.once('error', reject)
  })
}

describe('agent runtime unix socket transport', () => {
  const handles: Array<{ stop(): Promise<void>; socketPath: string }> = []

  afterEach(async () => {
    vi.restoreAllMocks()
    while (handles.length > 0) {
      const handle = handles.pop()
      if (!handle) continue
      await handle.stop()
    }
  })

  it('locks the unix socket down to the current user', async () => {
    const controller = new AgentRuntimeController()
    const socketPath = path.join(os.tmpdir(), `agent-runtime-${process.pid}-${Date.now()}-perm.sock`)
    const handle = await createUnixSocketTransportServer(controller, socketPath)
    handles.push(handle)

    expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600)
  })

  it('rejects oversized payloads before buffering them unboundedly', async () => {
    const controller = new AgentRuntimeController()
    const socketPath = path.join(os.tmpdir(), `agent-runtime-${process.pid}-${Date.now()}-budget.sock`)
    const handle = await createUnixSocketTransportServer(controller, socketPath)
    handles.push(handle)

    const hugePayload = JSON.stringify({
      hook_event_name: 'Notification',
      session_id: 'session-budget',
      message: 'x'.repeat((1024 * 1024) + 128),
    })

    const response = await connectAndCollect(socketPath, hugePayload)
    expect(JSON.parse(response)).toEqual({
      error: 'payload_too_large',
      limitBytes: 1024 * 1024,
    })
    expect(controller.getSnapshot().pendingPermissions).toHaveLength(0)
    expect(controller.getSnapshot().pendingQuestions).toHaveLength(0)
  })

  it('auto-denies malformed blocking requests instead of hanging the caller', async () => {
    const controller = new AgentRuntimeController()
    const socketPath = path.join(os.tmpdir(), `agent-runtime-${process.pid}-${Date.now()}-fallback.sock`)
    const handle = await createUnixSocketTransportServer(controller, socketPath)
    handles.push(handle)

    const response = await connectAndCollect(socketPath, {
      hook_event_name: 'PermissionRequest',
      session_id: 'session-fallback',
      tool_name: 'AskUserQuestion',
      tool_input: {},
    })

    expect(response).toBe(buildPermissionResponse('deny'))
    expect(controller.getSnapshot().pendingQuestions).toHaveLength(0)
  })

  it('clears pending approvals when the peer disconnects before responding', async () => {
    const controller = new AgentRuntimeController()
    const socketPath = path.join(os.tmpdir(), `agent-runtime-${process.pid}-${Date.now()}-disconnect.sock`)
    const handle = await createUnixSocketTransportServer(controller, socketPath)
    handles.push(handle)

    await connectAndDestroy(socketPath, {
      hook_event_name: 'PermissionRequest',
      session_id: 'session-disconnect',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf ~' },
    })

    await waitFor(() => controller.getSnapshot().pendingPermissions.length === 0)

    const snapshot = controller.getSnapshot()
    expect(snapshot.pendingPermissions).toHaveLength(0)
    expect(snapshot.sessions['session-disconnect']?.status).toBe('idle')
  })

  it('prunes ended sessions once they exceed the retention TTL', () => {
    const controller = new AgentRuntimeController()
    const nowSpy = vi.spyOn(Date, 'now')

    nowSpy.mockReturnValue(0)
    controller.handleIncomingEvent({ hook_event_name: 'SessionStart', session_id: 'stale-session', _source: 'codex' })
    controller.handleIncomingEvent({ hook_event_name: 'SessionEnd', session_id: 'stale-session', _source: 'codex' })

    nowSpy.mockReturnValue((24 * 60 * 60 * 1000) + 1)
    controller.handleIncomingEvent({ hook_event_name: 'SessionStart', session_id: 'fresh-session', _source: 'codex' })

    const snapshot = controller.getSnapshot()
    expect(snapshot.sessions['stale-session']).toBeUndefined()
    expect(snapshot.sessions['fresh-session']).toBeDefined()
  })

  it('marks stale live sessions ended once their CLI pid is gone', () => {
    const controller = new AgentRuntimeController()
    const nowSpy = vi.spyOn(Date, 'now')
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => {
      const error = new Error('process not found') as NodeJS.ErrnoException
      error.code = 'ESRCH'
      throw error
    }) as typeof process.kill)

    nowSpy.mockReturnValue(0)
    controller.handleIncomingEvent({
      hook_event_name: 'SessionStart',
      session_id: 'ghost-session',
      _source: 'codex',
      _ppid: 4242,
    })

    nowSpy.mockReturnValue((30 * 60 * 1000) + 1)
    controller.handleIncomingEvent({
      hook_event_name: 'Notification',
      session_id: 'fresh-session',
      _source: 'codex',
      message: 'still alive',
    })

    const snapshot = controller.getSnapshot()
    expect(killSpy).toHaveBeenCalledWith(4242, 0)
    expect(snapshot.sessions['ghost-session']?.status).toBe('completed')
    expect(snapshot.sessions['ghost-session']?.endedAt).toBe((30 * 60 * 1000) + 1)
  })

  it('propagates task ids through runtime sessions and pending items', () => {
    const controller = new AgentRuntimeController()

    controller.handleIncomingEvent({
      hook_event_name: 'SessionStart',
      session_id: 'task-session',
      _source: 'claude',
      _soulidity_task_id: 'task-123',
    })

    controller.handleIncomingEvent({
      hook_event_name: 'PermissionRequest',
      session_id: 'task-session',
      _source: 'claude',
      _soulidity_task_id: 'task-123',
      tool_name: 'Bash',
      tool_input: { command: 'pwd' },
    }, vi.fn())

    controller.handleIncomingEvent({
      hook_event_name: 'Notification',
      session_id: 'task-session',
      _source: 'claude',
      _soulidity_task_id: 'task-123',
      question: 'Ship it?',
    }, vi.fn())

    const snapshot = controller.getSnapshot()
    expect(snapshot.sessions['task-session']?.taskId).toBe('task-123')
    expect(snapshot.pendingPermissions[0]?.taskId).toBe('task-123')
    expect(snapshot.pendingQuestions[0]?.taskId).toBe('task-123')
    expect(toAgentStatusFile(snapshot).sessions['task-session']?.taskId).toBe('task-123')
  })

  it('collects all AskUserQuestion prompts before replying with the full answer map', () => {
    const controller = new AgentRuntimeController()
    const respond = vi.fn()

    const result = controller.handleIncomingEvent({
      hook_event_name: 'PermissionRequest',
      session_id: 'session-ask-user',
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [
          {
            header: 'repo',
            question: 'Which repo should I use?',
            options: [{ label: 'clawnews', description: 'Current workspace' }],
          },
          {
            header: 'branch',
            question: 'Which branch should I target?',
          },
        ],
      },
      _source: 'codex',
    }, respond)

    expect(result).toBe('deferred')

    const firstSnapshot = controller.getSnapshot()
    expect(firstSnapshot.pendingQuestions).toHaveLength(2)
    expect(firstSnapshot.pendingQuestions.map((item) => item.question)).toEqual([
      'Which repo should I use?',
      'Which branch should I target?',
    ])

    expect(controller.answerQuestion(firstSnapshot.pendingQuestions[0]!.requestId, 'clawnews')).toBe(true)
    expect(respond).not.toHaveBeenCalled()

    const secondSnapshot = controller.getSnapshot()
    expect(secondSnapshot.pendingQuestions).toHaveLength(1)
    expect(secondSnapshot.pendingQuestions[0]?.question).toBe('Which branch should I target?')

    expect(controller.answerQuestion(secondSnapshot.pendingQuestions[0]!.requestId, 'main')).toBe(true)
    expect(respond).toHaveBeenCalledTimes(1)
    expect(JSON.parse(respond.mock.calls[0]![0])).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'allow',
          updatedInput: {
            answers: {
              repo: 'clawnews',
              branch: 'main',
            },
          },
        },
      },
    })
    expect(controller.getSnapshot().pendingQuestions).toHaveLength(0)
  })
})
