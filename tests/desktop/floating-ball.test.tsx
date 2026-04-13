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
      moodInteract: vi.fn().mockResolvedValue(undefined),
      takeGreeting: vi.fn().mockResolvedValue({ greeting: '你好' }),
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
    expect(window.electronAPI.takeGreeting).toHaveBeenCalledOnce()
  })
})
