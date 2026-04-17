// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HookInstallStatus, SupportedAgentSource } from '@soulidity/shared'
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

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('HooksTab action visibility', () => {
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

  it('shows only Uninstall when every hook is installed and healthy', async () => {
    await renderWithStatuses([
      makeStatus('claude', 'Claude Code'),
      makeStatus('codex', 'Codex'),
      makeStatus('gemini', 'Gemini CLI'),
    ])

    expect(container.textContent).toContain('Uninstall')
    expect(container.textContent).not.toContain('Install All')
    expect(container.textContent).not.toContain('Repair')
  })

  it('shows Install All when a detected hook is not yet installed', async () => {
    await renderWithStatuses([
      makeStatus('claude', 'Claude Code'),
      makeStatus('codex', 'Codex', { installed: false, healthy: false }),
    ])

    expect(container.textContent).toContain('Install All')
    expect(container.textContent).toContain('Uninstall')
    expect(container.textContent).not.toContain('Repair')
  })

  it('shows Repair when an installed hook is unhealthy', async () => {
    await renderWithStatuses([
      makeStatus('claude', 'Claude Code'),
      makeStatus('codex', 'Codex', { healthy: false }),
    ])

    expect(container.textContent).toContain('Repair')
    expect(container.textContent).toContain('Uninstall')
    expect(container.textContent).not.toContain('Install All')
  })

  it('shows only Install All when nothing is installed yet', async () => {
    await renderWithStatuses([
      makeStatus('claude', 'Claude Code', { installed: false, healthy: false }),
      makeStatus('codex', 'Codex', { installed: false, healthy: false }),
    ])

    expect(container.textContent).toContain('Install All')
    expect(container.textContent).not.toContain('Repair')
    expect(container.textContent).not.toContain('Uninstall')
  })
})
