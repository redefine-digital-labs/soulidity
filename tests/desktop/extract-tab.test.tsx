// @vitest-environment jsdom

import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@mysten/dapp-kit', () => ({
  SuiClientProvider: ({ children }: { children: React.ReactNode }) => children,
  useSuiClient: () => null,
}))

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

  it('keeps the review flow stable when a legacy scan result omits sourceFiles', async () => {
    const legacyScanResult = {
      agentType: 'codex',
      coverage: 'partial',
      unsupportedMetrics: [],
      sessionCount: 1,
      totalTurns: 2,
      scanPeriod: { from: 0, to: 0 },
      features: {
        avgTurnsPerSession: 2,
        avgResponseLength: 10,
        toolUsageFrequency: {},
        topTools: ['Read'],
        primaryLanguages: ['TypeScript'],
        avgSessionDurationMs: 0,
        peakHours: [],
        usesCodeBlocks: false,
        avgCodeBlocksPerResponse: 0,
      },
    }

    window.electronAPI = {
      getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: false, accountId: null }),
      'extraction:scan-sessions': vi.fn().mockResolvedValue([legacyScanResult]),
      'extraction:get-openclaw-import-status': vi.fn().mockResolvedValue({
        detected: false,
        ready: false,
        workspacePath: null,
        soulFilePath: null,
        memoryFilePath: null,
        agentsFilePath: null,
        toolsFilePath: null,
        identityFilePath: null,
        userFilePath: null,
        validSkills: [],
        detail: 'OpenClaw not detected.',
      }),
      'extraction:get-local-agent-statuses': vi.fn().mockResolvedValue([]),
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

    expect(window.electronAPI['extraction:scan-sessions']).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Scan Evidence')
    expect(container.textContent).toContain('OpenClaw Import')
  })

  it('moves into the local create step instead of opening a browser handoff', async () => {
    vi.useFakeTimers()

    const createdDraft = {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceProfile: {
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
      },
      creationSource: {
        kind: 'local-agent',
        label: 'Created with Codex',
        agent: 'codex',
      },
      name: 'TS Thorough',
      description: 'A precise coding companion',
      tags: ['thorough', 'typescript'],
      royaltyBps: 500,
      traits: ['thorough'],
      communicationStyle: 'direct',
      expertise: ['TypeScript'],
      workStyle: 'focused',
      evidence: {
        sessionCount: 1,
        turnCount: 2,
        topTools: ['Read'],
        primaryLanguages: ['TypeScript'],
        peakHours: [],
      },
      coverImageDataUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E',
      coverImageFileName: 'extract-cover.svg',
      coverImageMimeType: 'image/svg+xml',
      coverImageGenerated: true,
      soulMarkdown: '# Soul Character',
      memoryMarkdown: '# Founding Memory',
      skillsArchive: null,
    }

    window.electronAPI = {
      getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: true, accountId: 'account-1' }),
      'extraction:scan-sessions': vi.fn().mockResolvedValue([{ agentType: 'codex', coverage: 'partial', unsupportedMetrics: [], sessionCount: 1, totalTurns: 2, scanPeriod: { from: 0, to: 0 }, sourceFiles: [], features: { avgTurnsPerSession: 2, avgResponseLength: 10, toolUsageFrequency: {}, topTools: ['Read'], primaryLanguages: ['TypeScript'], avgSessionDurationMs: 0, peakHours: [], usesCodeBlocks: false, avgCodeBlocksPerResponse: 0 } }]),
      'extraction:get-openclaw-import-status': vi.fn().mockResolvedValue({
        detected: false,
        ready: false,
        workspacePath: null,
        soulFilePath: null,
        memoryFilePath: null,
        agentsFilePath: null,
        toolsFilePath: null,
        identityFilePath: null,
        userFilePath: null,
        validSkills: [],
        detail: 'OpenClaw not detected.',
      }),
      'extraction:get-local-agent-statuses': vi.fn().mockResolvedValue([
        { agent: 'codex', status: 'available', detail: 'Ready.' },
      ]),
      'extraction:create-local-draft': vi.fn().mockResolvedValue(createdDraft),
      'extraction:open-web-create': vi.fn().mockResolvedValue(undefined),
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

    const setTextareaByLabel = async (labelText: string, value: string) => {
      const labels = Array.from(container.querySelectorAll('span.settings-field__label'))
      const label = labels.find((candidate) => candidate.textContent === labelText)
      expect(label).toBeTruthy()
      const textarea = label!.parentElement!.querySelector('textarea') as HTMLTextAreaElement | null
      expect(textarea).toBeTruthy()
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      await act(async () => {
        setter.call(textarea!, value)
        textarea!.dispatchEvent(new Event('input', { bubbles: true }))
        await flushPromises()
      })
    }

    await clickButton('Start Scan')
    await clickButton('Create with Codex')
    await setTextareaByLabel('Character Type *', 'AI Coder')
    await clickButton('Generate Draft with Codex')
    await act(async () => {
      vi.advanceTimersByTime(150)
      await flushPromises()
    })

    expect(container.textContent).toContain('Created with Codex')
    expect(window.electronAPI['extraction:create-local-draft']).toHaveBeenCalledWith({
      agent: 'codex',
      scanResults: [{
        agentType: 'codex',
        coverage: 'partial',
        unsupportedMetrics: [],
        sessionCount: 1,
        totalTurns: 2,
        scanPeriod: { from: 0, to: 0 },
        sourceFiles: [],
        features: {
          avgTurnsPerSession: 2,
          avgResponseLength: 10,
          toolUsageFrequency: {},
          topTools: ['Read'],
          primaryLanguages: ['TypeScript'],
          avgSessionDurationMs: 0,
          peakHours: [],
          usesCodeBlocks: false,
          avgCodeBlocksPerResponse: 0,
        },
      }],
      direction: {
        characterType: 'AI Coder',
        extraDescription: '',
      },
    })
    expect(window.electronAPI['extraction:open-web-create']).not.toHaveBeenCalled()
    expect(window.electronAPI['desktop:create-draft:save']).toHaveBeenCalled()

    vi.useRealTimers()
  })
})
