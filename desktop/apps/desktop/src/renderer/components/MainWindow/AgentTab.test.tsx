// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeSnapshot } from '@soulidity/shared'
import { AgentTab } from './AgentTab'

vi.mock('../../hooks/useAgentRuntime', () => ({
  useAgentRuntime: vi.fn(),
}))

import { useAgentRuntime } from '../../hooks/useAgentRuntime'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createSnapshot(): AgentRuntimeSnapshot {
  return {
    version: 1,
    lastUpdated: 1_713_700_000_000,
    transport: {
      status: 'ready',
      mode: 'unix-socket',
      endpoint: '/tmp/soulidity.sock',
    },
    pendingPermissions: [],
    pendingQuestions: [],
    hooks: [],
    sessions: {
      'session-2': {
        sessionId: 'session-2',
        source: 'claude',
        clientType: 'claude-code',
        status: 'running',
        startedAt: 1_713_699_700_000,
        lastUpdated: 1_713_700_000_000,
        workingDirectory: '/Users/admin/Desktop/nao/clawnews',
        sessionTitle: 'Investigate runtime sync',
        currentTool: 'Read',
        recentMessages: [],
        toolHistory: [],
      },
      'session-1': {
        sessionId: 'session-1',
        source: 'codex',
        clientType: 'codex',
        status: 'completed',
        startedAt: 1_713_699_000_000,
        lastUpdated: 1_713_699_500_000,
        endedAt: 1_713_699_600_000,
        workingDirectory: '/tmp/project',
        sessionTitle: 'Patch settings layout',
        currentTool: 'Edit',
        recentMessages: [],
        toolHistory: [],
      },
    },
  }
}

describe('AgentTab', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    Object.defineProperty(window, 'electronAPI', {
      value: {
        approveAgentPermission: vi.fn(),
        denyAgentPermission: vi.fn(),
        answerAgentQuestion: vi.fn(),
        skipAgentQuestion: vi.fn(),
      } as Partial<Window['electronAPI']>,
      configurable: true,
    })
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

  it('renders sessions in a single stack and updates details when selection changes', async () => {
    vi.mocked(useAgentRuntime).mockReturnValue({ snapshot: createSnapshot() })

    root = createRoot(container)
    await act(async () => {
      root.render(<AgentTab />)
      await flushEffects()
    })

    expect(container.textContent).toContain('Sessions')
    expect(container.textContent).toContain('1 active · 1 recent')
    expect(container.textContent).toContain('Investigate runtime sync')
    expect(container.textContent).toContain('Patch settings layout')
    expect(container.textContent).toContain('Claude Code · session-2')

    const secondSession = Array.from(container.querySelectorAll('.agent-session-row')).find((row) =>
      row.textContent?.includes('Patch settings layout'),
    ) as HTMLButtonElement | undefined
    expect(secondSession).toBeTruthy()

    await act(async () => {
      secondSession?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(container.textContent).toContain('Codex · session-1')
    expect(secondSession?.getAttribute('aria-pressed')).toBe('true')
  })

  it('preserves long tool descriptions for hover while rendering the recent tools list', async () => {
    const snapshot = createSnapshot()
    const longToolDescription =
      '/Users/admin/Desktop/nao/clawnews/desktop/apps/desktop/src/renderer/components/MainWindow/AgentTab.tsx#very-long-read-command-with-no-natural-breakpoints'

    snapshot.sessions['session-2']!.toolHistory = [{
      tool: 'Read',
      description: longToolDescription,
      timestamp: 1_713_700_000_000,
    }]

    vi.mocked(useAgentRuntime).mockReturnValue({ snapshot })

    root = createRoot(container)
    await act(async () => {
      root.render(<AgentTab />)
      await flushEffects()
    })

    const toolDescription = Array.from(container.querySelectorAll('.agent-timeline-row__text')).find((node) =>
      node.textContent === longToolDescription,
    ) as HTMLSpanElement | undefined

    expect(toolDescription).toBeTruthy()
    expect(toolDescription?.title).toBe(longToolDescription)
  })
})
