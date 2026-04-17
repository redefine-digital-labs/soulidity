// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeSnapshot, HookInstallStatus, SupportedAgentSource } from '@soulidity/shared'
import { HooksTab } from './HooksTab'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type MockElectronApi = Pick<
  Window['electronAPI'],
  | 'getHookInstallStatus'
  | 'installHooks'
  | 'repairHooks'
  | 'uninstallHooks'
  | 'getCurrentAgentRuntime'
  | 'onAgentRuntimeChanged'
>

function makeStatus(
  source: SupportedAgentSource,
  label: string,
  overrides: Partial<HookInstallStatus> = {},
): HookInstallStatus {
  return {
    source,
    label,
    detected: true,
    installed: true,
    healthy: true,
    ...overrides,
  }
}

function createElectronApi(
  statuses: HookInstallStatus[],
  overrides: Partial<MockElectronApi> = {},
): MockElectronApi {
  return {
    getHookInstallStatus: vi.fn().mockResolvedValue(statuses),
    installHooks: vi.fn().mockResolvedValue(statuses),
    repairHooks: vi.fn().mockResolvedValue(statuses),
    uninstallHooks: vi.fn().mockResolvedValue(statuses),
    getCurrentAgentRuntime: vi.fn().mockResolvedValue(null),
    onAgentRuntimeChanged: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  }
}

function expectRecoveryActionsVisible(container: HTMLDivElement) {
  expect(container.textContent).toContain('Install All')
  expect(container.textContent).toContain('Repair')
  expect(container.textContent).toContain('Uninstall')
  expect(container.textContent).not.toContain('No hook actions available.')
}

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('HooksTab recovery actions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
    }
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  async function renderWithStatuses(statuses: HookInstallStatus[]) {
    Object.defineProperty(window, 'electronAPI', {
      value: createElectronApi(statuses) as unknown as Window['electronAPI'],
      configurable: true,
    })
    root = createRoot(container)
    await act(async () => {
      root.render(<HooksTab />)
      await flushEffects()
      await flushEffects()
    })
  }

  it('keeps install, repair, and uninstall visible when hook statuses are unknown', async () => {
    await renderWithStatuses([])

    expectRecoveryActionsVisible(container)
  })

  it('keeps recovery actions visible after a runtime snapshot overwrites fresher hook status', async () => {
    let runtimeChanged: ((snapshot: AgentRuntimeSnapshot | null) => void) | null = null
    Object.defineProperty(window, 'electronAPI', {
      value: createElectronApi(
        [makeStatus('claude', 'Claude Code', { installed: false, healthy: false })],
        {
          onAgentRuntimeChanged: vi.fn().mockImplementation((callback) => {
            runtimeChanged = callback
            return () => {}
          }),
        },
      ) as unknown as Window['electronAPI'],
      configurable: true,
    })

    root = createRoot(container)
    await act(async () => {
      root.render(<HooksTab />)
      await flushEffects()
      await flushEffects()
    })

    await act(async () => {
      runtimeChanged?.({
        version: 1,
        lastUpdated: Date.now(),
        transport: { status: 'ready', mode: 'unix-socket' },
        sessions: {},
        pendingPermissions: [],
        pendingQuestions: [],
        hooks: [makeStatus('claude', 'Claude Code')],
      })
      await flushEffects()
    })

    expectRecoveryActionsVisible(container)
  })

  it('keeps recovery actions visible when every hook is installed and healthy', async () => {
    await renderWithStatuses([
      makeStatus('claude', 'Claude Code'),
      makeStatus('codex', 'Codex'),
      makeStatus('gemini', 'Gemini CLI'),
    ])

    expectRecoveryActionsVisible(container)
  })
})
