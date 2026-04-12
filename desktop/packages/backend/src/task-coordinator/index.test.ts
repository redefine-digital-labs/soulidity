import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessageData } from '@soulidity/shared'

type AgentLoopParams = {
  prompt: string
  history: ChatMessageData[]
  onToken: (delta: string) => void
  onDone: (fullContent: string, newMessages: ChatMessageData[]) => void
  onError: (code: string, message: string) => void
  onStatus?: (text: string) => void
  signal?: AbortSignal
}

const loopState: {
  params: AgentLoopParams | null
  controller: AbortController | null
} = {
  params: null,
  controller: null,
}

vi.mock('../agent/loop', () => ({
  agentLoop: vi.fn((params: AgentLoopParams) => {
    loopState.params = params
    loopState.controller = new AbortController()
    return loopState.controller
  }),
}))

import { TaskCoordinator } from './index'

describe('TaskCoordinator shutdown', () => {
  afterEach(() => {
    loopState.params = null
    loopState.controller = null
    vi.clearAllMocks()
  })

  it('drains running and queued tasks in order and ignores late completion callbacks', () => {
    const pushed: Array<{ userContent: string; messages: ChatMessageData[] }> = []
    const coordinator = new TaskCoordinator(
      () => [],
      (messages, userContent) => {
        pushed.push({ userContent, messages })
      },
    )

    const callbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onCancelled: vi.fn(),
    }

    expect(coordinator.enqueue('task-1', 'first prompt', callbacks)).toBe(true)
    expect(coordinator.enqueue('task-2', 'second prompt', callbacks)).toBe(true)
    expect(loopState.params?.prompt).toBe('first prompt')

    const drained = coordinator.shutdown()

    expect(drained).toEqual([
      { taskId: 'task-1', content: 'first prompt' },
      { taskId: 'task-2', content: 'second prompt' },
    ])
    expect(loopState.controller?.signal.aborted).toBe(true)

    loopState.params?.onDone('late reply', [{ role: 'assistant', content: 'late reply' }])

    expect(pushed).toEqual([])
    expect(coordinator.busy).toBe(false)
    expect(coordinator.pendingCount).toBe(0)
  })

  it('rejects new tasks after shutdown starts', () => {
    const coordinator = new TaskCoordinator(
      () => [],
      () => undefined,
    )

    const callbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onCancelled: vi.fn(),
    }

    expect(coordinator.enqueue('task-1', 'first prompt', callbacks)).toBe(true)
    coordinator.shutdown()

    expect(coordinator.enqueue('task-2', 'second prompt', callbacks)).toBe(false)
  })
})
