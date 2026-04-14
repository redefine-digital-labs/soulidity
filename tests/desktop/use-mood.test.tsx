// @vitest-environment jsdom

import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

import { useMood } from '../../desktop/apps/desktop/src/renderer/hooks/useMood'
import type { MoodSnapshot } from '../../desktop/packages/shared/src/types/emotion'

function flushPromises() {
  return Promise.resolve()
}

function Probe() {
  const { mood } = useMood(60_000)
  return <div data-testid="mood">{mood}</div>
}

describe('useMood', () => {
  let container: HTMLDivElement
  let root: Root
  let initialSnapshot: MoodSnapshot
  let changeCallback: ((snapshot: unknown) => void) | null

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    changeCallback = null
    initialSnapshot = {
      mood: 'idle',
      reason: 'init',
      updatedAt: new Date('2026-04-13T08:00:00.000Z').toISOString(),
      phrases: [],
      intensity: 0.3,
      ambientLevel: 'low',
      spriteAnimation: 'idle',
    }

    window.electronAPI = {
      getMoodSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
      onMoodChanged: vi.fn((callback: (snapshot: unknown) => void) => {
        changeCallback = callback
        return () => {}
      }),
    } as typeof window.electronAPI
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
      await flushPromises()
    })
    container.remove()
  })

  it('subscribes to push updates and applies them immediately', async () => {
    await act(async () => {
      root.render(<Probe />)
      await flushPromises()
    })

    expect(window.electronAPI.onMoodChanged).toHaveBeenCalledOnce()
    expect(container.querySelector('[data-testid="mood"]')?.textContent).toBe('idle')

    await act(async () => {
      changeCallback?.({
        ...initialSnapshot,
        mood: 'working',
        reason: 'cli_working',
        spriteAnimation: 'working',
      })
      await flushPromises()
    })

    expect(container.querySelector('[data-testid="mood"]')?.textContent).toBe('working')
  })
})
