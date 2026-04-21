// @vitest-environment jsdom

import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../desktop/apps/desktop/src/renderer/components/ChatBubble', () => ({
  ChatBubble: () => null,
}))

vi.mock('../../desktop/apps/desktop/src/renderer/components/SpriteRenderer', () => ({
  SpriteRenderer: () => null,
}))

vi.mock('../../desktop/apps/desktop/src/renderer/hooks/useMood', () => ({
  useMood: () => ({
    snapshot: {
      mood: 'idle',
      reason: 'init',
      updatedAt: new Date('2026-04-13T08:00:00.000Z').toISOString(),
      phrases: [],
      intensity: 0.3,
      ambientLevel: 'low',
      spriteAnimation: 'idle',
    },
    mood: 'idle',
    spriteAnimation: 'idle',
  }),
}))

vi.mock('../../desktop/apps/desktop/src/renderer/hooks/useCliStatus', () => ({
  useCliStatus: () => ({ status: 'idle' }),
}))

const notifyDragStart = vi.fn()
const notifyDragEnd = vi.fn()

vi.mock('../../desktop/apps/desktop/src/renderer/hooks/useMoodResolver', () => ({
  useMoodResolver: () => ({
    notifyDragStart,
    notifyDragEnd,
    resolveMoodOverride: (backendMood: string) => backendMood,
  }),
}))

import { FloatingBall } from '../../desktop/apps/desktop/src/renderer/components/FloatingBall'

function flushPromises() {
  return Promise.resolve()
}

function createFileDropEvent(filePaths: string[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: ['Files'],
      files: filePaths.map((path) => ({ path })),
    },
  })
  return event
}

function setFieldValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = Object.getPrototypeOf(element)
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('FloatingBall', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    window.electronAPI = {
      dragStart: vi.fn(),
      dragMove: vi.fn(),
      dragEnd: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      showContextMenu: vi.fn(),
      resizePetWindow: vi.fn(),
      getConfig: vi.fn().mockResolvedValue({ petEnhancedMotion: false }),
      onConfigChanged: vi.fn().mockReturnValue(() => {}),
      moodInteract: vi.fn().mockResolvedValue(undefined),
      moodDragStart: vi.fn().mockResolvedValue(undefined),
      moodDragEnd: vi.fn().mockResolvedValue(undefined),
      getCurrentAgentStatus: vi.fn().mockResolvedValue(null),
      getCurrentAgentRuntime: vi.fn().mockResolvedValue(null),
      getUpdateStatus: vi.fn().mockResolvedValue({ state: 'idle' }),
      onAgentStatusChanged: vi.fn().mockReturnValue(() => {}),
      onAgentRuntimeChanged: vi.fn().mockReturnValue(() => {}),
      onAgentEvent: vi.fn().mockReturnValue(() => {}),
      onUpdateStatus: vi.fn().mockReturnValue(() => {}),
      onTaskOutput: vi.fn().mockReturnValue(() => {}),
      onTaskComplete: vi.fn().mockReturnValue(() => {}),
      executeTask: vi.fn().mockResolvedValue({ taskId: 'test-task' }),
      cancelTask: vi.fn(),
      updaterDownload: vi.fn().mockResolvedValue({ ok: true }),
      updaterInstall: vi.fn().mockResolvedValue(undefined),
    } as typeof window.electronAPI
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
      await flushPromises()
    })
    container.remove()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('reports mood interaction on single click', async () => {
    await act(async () => {
      root.render(<FloatingBall />)
      await flushPromises()
    })

    const ball = container.querySelector('.ball') as HTMLDivElement | null
    expect(ball).not.toBeNull()

    Object.defineProperty(ball!, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })

    await act(async () => {
      ball!.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: 20,
        clientY: 20,
      }))
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        clientX: 20,
        clientY: 20,
      }))
      vi.advanceTimersByTime(300)
      await flushPromises()
    })

    expect(window.electronAPI.moodInteract).toHaveBeenCalledOnce()
  })

  it('opens from a dropped file and requires explicit approval before starting a write task', async () => {
    await act(async () => {
      root.render(<FloatingBall />)
      await flushPromises()
    })

    const rootNode = container.querySelector('.ball-root') as HTMLDivElement | null
    expect(rootNode).not.toBeNull()

    await act(async () => {
      rootNode!.dispatchEvent(createFileDropEvent(['/tmp/example.ts']))
      await flushPromises()
    })

    expect(container.textContent).toContain('Review Task')
    expect(container.textContent).not.toContain('Quick Capture')

    const writeButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Write',
    )
    expect(writeButton).toBeTruthy()

    await act(async () => {
      writeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea).not.toBeNull()
    await act(async () => {
      setFieldValue(textarea!, 'Apply the requested patch and update the related tests.')
      await flushPromises()
    })

    const reviewButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Review Write Plan',
    )
    expect(reviewButton).toBeTruthy()

    await act(async () => {
      reviewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(container.textContent).toContain('Write Approval')
    expect(window.electronAPI.executeTask).not.toHaveBeenCalled()

    const approveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Approve & Run',
    )
    expect(approveButton).toBeTruthy()

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(window.electronAPI.executeTask).toHaveBeenCalledWith(expect.objectContaining({
      executionMode: 'write',
      filePaths: ['/tmp/example.ts'],
    }))
    const payload = vi.mocked(window.electronAPI.executeTask).mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('captureId')
  })
})
