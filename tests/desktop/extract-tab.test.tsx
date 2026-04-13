// @vitest-environment jsdom

import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

import { ExtractTab } from '../../desktop/apps/desktop/src/renderer/components/MainWindow/ExtractTab'

function flushPromises() {
  return Promise.resolve()
}

describe('ExtractTab', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
      await flushPromises()
    })
    container.remove()
    vi.restoreAllMocks()
  })

  it('shows the real scan error when IPC invoke fails', async () => {
    window.electronAPI = {
      'extraction:scan-sessions': vi.fn().mockRejectedValue(new Error('bad codex entry')),
      'extraction:scan-progress': vi.fn().mockReturnValue(() => {}),
    } as typeof window.electronAPI

    await act(async () => {
      root.render(<ExtractTab />)
      await flushPromises()
    })

    const startButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Start Scan')
    expect(startButton).toBeTruthy()

    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(container.textContent).toContain('bad codex entry')
    expect(container.textContent).not.toContain('Scan IPC not available')
  })

  it('keeps the compatibility hint when scan IPC is missing', async () => {
    window.electronAPI = {
      getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: true, accountId: 'account-1' }),
    } as typeof window.electronAPI

    await act(async () => {
      root.render(<ExtractTab />)
      await flushPromises()
    })

    const startButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Start Scan')
    expect(startButton).toBeTruthy()

    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(container.textContent).toContain('Scan IPC not available')
  })

  it('blocks scanning before desktop auth is linked and shows a settings CTA', async () => {
    window.electronAPI = {
      getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: false, accountId: null }),
      'extraction:scan-sessions': vi.fn(),
      'extraction:scan-progress': vi.fn().mockReturnValue(() => {}),
    } as typeof window.electronAPI

    await act(async () => {
      root.render(<ExtractTab />)
      await flushPromises()
    })

    const startButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Start Scan')
    expect(startButton).toBeTruthy()

    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(window.electronAPI['extraction:scan-sessions']).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Link this desktop in Settings before scanning')
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Open Settings')).toBe(true)
  })

  it('moves into the local create step instead of opening a browser handoff', async () => {
    vi.useFakeTimers()

    window.electronAPI = {
      getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: true, accountId: 'account-1' }),
      'extraction:scan-sessions': vi.fn().mockResolvedValue([{ agentType: 'codex', coverage: 'partial', unsupportedMetrics: [], sessionCount: 1, totalTurns: 2, scanPeriod: { from: 0, to: 0 }, features: { avgTurnsPerSession: 2, avgResponseLength: 10, toolUsageFrequency: {}, topTools: ['Read'], primaryLanguages: ['TypeScript'], avgSessionDurationMs: 0, peakHours: [], usesCodeBlocks: false, avgCodeBlocksPerResponse: 0 } }]),
      'extraction:analyze-profile': vi.fn().mockResolvedValue({
        version: 1,
        personality: {
          traits: ['thorough'],
          communicationStyle: 'direct',
          expertise: ['TypeScript'],
          workStyle: 'focused',
        },
        evidence: {
          sessionCount: 1,
          turnCount: 2,
          topTools: ['Read'],
          primaryLanguages: ['TypeScript'],
          peakHours: [],
        },
        suggested: {
          name: 'TS Thorough',
          description: 'A precise coding companion',
          tags: ['thorough', 'typescript'],
        },
      }),
      'extraction:scan-progress': vi.fn().mockReturnValue(() => {}),
      'desktop:create-draft:load': vi.fn().mockResolvedValue(null),
      'desktop:create-draft:save': vi.fn().mockResolvedValue(undefined),
      'desktop:create-draft:clear': vi.fn().mockResolvedValue(undefined),
    } as typeof window.electronAPI

    await act(async () => {
      root.render(<ExtractTab />)
      await flushPromises()
    })

    const clickButton = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button'))
        .find((candidate) => candidate.textContent === label)
      expect(button).toBeTruthy()
      await act(async () => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await flushPromises()
      })
    }

    await clickButton('Start Scan')
    await clickButton('Create Locally')
    await act(async () => {
      vi.advanceTimersByTime(150)
      await flushPromises()
    })

    expect(container.textContent).toContain('Create Soul Locally')
    expect(container.textContent).not.toContain('Open in Browser')
    expect(window.electronAPI['desktop:create-draft:save']).toHaveBeenCalled()

    vi.useRealTimers()
  })
})
