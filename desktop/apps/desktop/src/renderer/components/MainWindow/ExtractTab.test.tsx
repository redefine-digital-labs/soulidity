// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtractSoulDraft, LocalExtractAgentStatus, OpenClawImportStatus, SessionScanResult } from '@soulidity/shared'
import { ExtractTab } from './ExtractTab'

vi.mock('@tanstack/react-query', () => ({
  QueryClient: class QueryClient {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@mysten/dapp-kit', () => ({
  SuiClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSuiClient: () => null,
}))

vi.mock('../../lib/hooks/use-desktop-wallet', () => ({
  useDesktopWallet: () => ({
    suiWallet: null,
    signAndExecute: vi.fn(),
    signPersonalMessage: vi.fn(),
    suiClient: null,
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function flushEffects() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function makeScanResult(): SessionScanResult {
  return {
    agentType: 'codex',
    coverage: 'partial',
    unsupportedMetrics: [],
    sessionCount: 3,
    totalTurns: 18,
    scanPeriod: { from: 1_700_000_000_000, to: 1_700_100_000_000 },
    sourceFiles: ['/Users/admin/.codex/sessions/demo/session-1.jsonl'],
    features: {
      avgTurnsPerSession: 6,
      avgResponseLength: 420,
      toolUsageFrequency: {
        Read: 8,
        Edit: 5,
      },
      topTools: ['Read', 'Edit'],
      primaryLanguages: ['TypeScript'],
      avgSessionDurationMs: 0,
      peakHours: [11, 15],
      usesCodeBlocks: true,
      avgCodeBlocksPerResponse: 1.5,
    },
  }
}

function makeOpenClawStatus(overrides: Partial<OpenClawImportStatus> = {}): OpenClawImportStatus {
  return {
    detected: true,
    ready: true,
    workspacePath: '/Users/admin/.openclaw/workspace',
    soulFilePath: '/Users/admin/.openclaw/workspace/SOUL.md',
    memoryFilePath: '/Users/admin/.openclaw/workspace/memory.md',
    agentsFilePath: '/Users/admin/.openclaw/workspace/AGENTS.md',
    toolsFilePath: '/Users/admin/.openclaw/workspace/TOOLS.md',
    identityFilePath: '/Users/admin/.openclaw/workspace/IDENTITY.md',
    userFilePath: '/Users/admin/.openclaw/workspace/USER.md',
    validSkills: [{
      id: 'skills/market-scout',
      label: 'market_scout (market-scout)',
      relativePath: 'skills/market-scout',
      skillName: 'market_scout',
    }],
    detail: 'OpenClaw workspace is ready to import into the local create flow.',
    ...overrides,
  }
}

function makeAgentStatuses(statuses: Partial<LocalExtractAgentStatus>[] = []): LocalExtractAgentStatus[] {
  return statuses.map((status, index) => ({
    agent: index === 0 ? 'codex' : 'claude',
    status: 'available',
    detail: 'Ready.',
    ...status,
  }))
}

function makeDraft(overrides: Partial<ExtractSoulDraft> = {}): ExtractSoulDraft {
  const now = new Date().toISOString()
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    sourceProfile: {
      version: 1,
      personality: {
        traits: ['deliberate'],
        communicationStyle: 'direct',
        expertise: ['TypeScript'],
        workStyle: 'implementation first',
      },
      evidence: {
        sessionCount: 3,
        turnCount: 18,
        topTools: ['Read', 'Edit'],
        primaryLanguages: ['TypeScript'],
        peakHours: [11, 15],
      },
      suggested: {
        name: 'Imported Soul',
        description: 'Imported from local files.',
        tags: ['openclaw'],
      },
    },
    creationSource: {
      kind: 'openclaw-import',
      label: 'Imported from OpenClaw',
      workspacePath: '/Users/admin/.openclaw/workspace',
    },
    name: 'Imported Soul',
    description: 'Imported from local files.',
    tags: ['openclaw'],
    royaltyBps: 500,
    traits: ['deliberate'],
    communicationStyle: 'direct',
    expertise: ['TypeScript'],
    workStyle: 'implementation first',
    evidence: {
      sessionCount: 3,
      turnCount: 18,
      topTools: ['Read', 'Edit'],
      primaryLanguages: ['TypeScript'],
      peakHours: [11, 15],
    },
    coverImageDataUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E',
    coverImageFileName: 'extract-cover.svg',
    coverImageMimeType: 'image/svg+xml',
    coverImageGenerated: true,
    soulMarkdown: '# Soul Character\n\n## Core Truths\n- What this Soul is here to do: help.\n',
    memoryMarkdown: '# Founding Memory\n\n## Origin Snapshot\n- Where this Soul starts: here.\n',
    skillsArchive: null,
    ...overrides,
  }
}

type MockElectronApi = Pick<
  Window['electronAPI'],
  | 'getDesktopAuthStatus'
  | 'desktop:create-draft:load'
  | 'desktop:create-draft:save'
  | 'desktop:create-draft:clear'
  | 'desktop:create-draft:pick-cover-image'
  | 'getDesktopRuntimeConfig'
  | 'extraction:scan-sessions'
  | 'extraction:get-openclaw-import-status'
  | 'extraction:get-local-agent-statuses'
  | 'extraction:import-openclaw-draft'
  | 'extraction:create-local-draft'
  | 'extraction:open-web-create'
  | 'extraction:scan-progress'
>

function createElectronApi(overrides: Partial<MockElectronApi> = {}): MockElectronApi {
  return {
    getDesktopAuthStatus: vi.fn().mockResolvedValue({ hasToken: false, accountId: null }),
    'desktop:create-draft:load': vi.fn().mockResolvedValue(null),
    'desktop:create-draft:save': vi.fn().mockResolvedValue(undefined),
    'desktop:create-draft:clear': vi.fn().mockResolvedValue(undefined),
    'desktop:create-draft:pick-cover-image': vi.fn().mockResolvedValue({
      dataUrl: 'data:image/png;base64,Y292ZXI=',
      fileName: 'custom-cover.png',
      mimeType: 'image/png',
    }),
    getDesktopRuntimeConfig: vi.fn().mockResolvedValue({
      suiNetwork: 'testnet',
      webBaseUrl: 'https://clawnews-mu.vercel.app',
      authReady: false,
      authBlocker: 'Desktop wallet auth is not configured yet.',
    }),
    'extraction:scan-sessions': vi.fn().mockResolvedValue([makeScanResult()]),
    'extraction:get-openclaw-import-status': vi.fn().mockResolvedValue(makeOpenClawStatus()),
    'extraction:get-local-agent-statuses': vi.fn().mockResolvedValue(makeAgentStatuses([
      { agent: 'codex' },
      { agent: 'claude' },
    ])),
    'extraction:import-openclaw-draft': vi.fn().mockResolvedValue(makeDraft()),
    'extraction:create-local-draft': vi.fn().mockResolvedValue(makeDraft({
      creationSource: {
        kind: 'local-agent',
        label: 'Created with Codex',
        agent: 'codex',
      },
      name: 'Codex Draft',
    })),
    'extraction:open-web-create': vi.fn().mockResolvedValue(undefined),
    'extraction:scan-progress': vi.fn().mockReturnValue(() => {}),
    ...overrides,
  }
}

async function click(container: HTMLDivElement, label: string) {
  const button = Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.includes(label))
  expect(button).toBeTruthy()
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushEffects()
    await flushEffects()
  })
}

describe('ExtractTab', () => {
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

  async function renderWithApi(api: MockElectronApi) {
    Object.defineProperty(window, 'electronAPI', {
      value: api as unknown as Window['electronAPI'],
      configurable: true,
    })

    root = createRoot(container)
    await act(async () => {
      root.render(<ExtractTab />)
      await flushEffects()
      await flushEffects()
    })
  }

  it('offers OpenClaw import plus local Codex and Claude creation after a scan', async () => {
    await renderWithApi(createElectronApi())
    await click(container, 'Start Scan')

    expect(container.textContent).toContain('Import OpenClaw Files')
    expect(container.textContent).toContain('Create with Codex')
    expect(container.textContent).toContain('Create with Claude')
    expect(container.textContent).toContain('OpenClaw workspace is ready')
  })

  it('renders the review step even when a legacy scan result omits sourceFiles', async () => {
    const legacyScanResult = { ...makeScanResult() } as Record<string, unknown>
    delete legacyScanResult.sourceFiles

    await renderWithApi(createElectronApi({
      'extraction:scan-sessions': vi.fn().mockResolvedValue([legacyScanResult as unknown as SessionScanResult]),
    }))

    await click(container, 'Start Scan')

    expect(container.textContent).toContain('Scan Evidence')
    expect(container.textContent).toContain('OpenClaw Import')
  })

  it('falls back to web create when no OpenClaw import or local agent is available', async () => {
    const openWebCreate = vi.fn().mockResolvedValue(undefined)
    await renderWithApi(createElectronApi({
      'extraction:get-openclaw-import-status': vi.fn().mockResolvedValue(makeOpenClawStatus({
        ready: false,
        soulFilePath: null,
        memoryFilePath: null,
        detail: 'OpenClaw workspace is missing SOUL.md.',
      })),
      'extraction:get-local-agent-statuses': vi.fn().mockResolvedValue(makeAgentStatuses([
        { agent: 'codex', status: 'not-installed', detail: 'codex not found' },
        { agent: 'claude', status: 'not-authenticated', detail: 'Login required' },
      ])),
      'extraction:open-web-create': openWebCreate,
    }))

    await click(container, 'Start Scan')
    expect(container.textContent).toContain('Open Web Create')

    await click(container, 'Open Web Create')
    expect(openWebCreate).toHaveBeenCalledTimes(1)
  })

  it('passes the selected OpenClaw skill into the import request', async () => {
    const importOpenClawDraft = vi.fn().mockResolvedValue(makeDraft())
    await renderWithApi(createElectronApi({
      'extraction:get-openclaw-import-status': vi.fn().mockResolvedValue(makeOpenClawStatus({
        validSkills: [
          {
            id: 'skills/alpha',
            label: 'alpha (alpha)',
            relativePath: 'skills/alpha',
            skillName: 'alpha',
          },
          {
            id: 'skills/beta',
            label: 'beta (beta)',
            relativePath: 'skills/beta',
            skillName: 'beta',
          },
        ],
      })),
      'extraction:get-local-agent-statuses': vi.fn().mockResolvedValue([]),
      'extraction:import-openclaw-draft': importOpenClawDraft,
    }))

    await click(container, 'Start Scan')

    const select = container.querySelector('select') as HTMLSelectElement | null
    expect(select).toBeTruthy()

    await act(async () => {
      if (select) {
        select.value = 'skills/beta'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
      await flushEffects()
    })

    await click(container, 'Import OpenClaw Files')

    expect(importOpenClawDraft).toHaveBeenCalledWith({
      scanResults: [makeScanResult()],
      skillId: 'skills/beta',
    })
    expect(container.textContent).toContain('Imported from OpenClaw')
    const nameInput = container.querySelector('input[type="text"]') as HTMLInputElement | null
    expect(nameInput?.value).toBe('Imported Soul')
  })

  it('creates a local Codex draft and enters the edit flow', async () => {
    const createLocalDraft = vi.fn().mockResolvedValue(makeDraft({
      creationSource: {
        kind: 'local-agent',
        label: 'Created with Codex',
        agent: 'codex',
      },
      name: 'Codex Draft',
      description: 'Created locally with Codex.',
    }))

    await renderWithApi(createElectronApi({
      'extraction:get-openclaw-import-status': vi.fn().mockResolvedValue(makeOpenClawStatus({
        ready: false,
        soulFilePath: null,
        memoryFilePath: null,
        detail: 'OpenClaw workspace is missing SOUL.md.',
      })),
      'extraction:get-local-agent-statuses': vi.fn().mockResolvedValue(makeAgentStatuses([
        { agent: 'codex', status: 'available', detail: 'Ready.' },
        { agent: 'claude', status: 'not-installed', detail: 'claude not found' },
      ])),
      'extraction:create-local-draft': createLocalDraft,
    }))

    await click(container, 'Start Scan')
    await click(container, 'Create with Codex')

    expect(createLocalDraft).toHaveBeenCalledWith({
      agent: 'codex',
      scanResults: [makeScanResult()],
    })
    expect(container.textContent).toContain('Created with Codex')
    const nameInput = container.querySelector('input[type="text"]') as HTMLInputElement | null
    expect(nameInput?.value).toBe('Codex Draft')
  })

  it('treats the generated cover as required until the user uploads a replacement', async () => {
    const pickCoverImage = vi.fn().mockResolvedValue({
      dataUrl: 'data:image/png;base64,Y292ZXI=',
      fileName: 'custom-cover.png',
      mimeType: 'image/png',
    })

    await renderWithApi(createElectronApi({
      'extraction:get-openclaw-import-status': vi.fn().mockResolvedValue(makeOpenClawStatus({
        ready: false,
        soulFilePath: null,
        memoryFilePath: null,
        detail: 'OpenClaw workspace is missing SOUL.md.',
      })),
      'extraction:get-local-agent-statuses': vi.fn().mockResolvedValue(makeAgentStatuses([
        { agent: 'codex', status: 'available', detail: 'Ready.' },
      ])),
      'desktop:create-draft:pick-cover-image': pickCoverImage,
    }))

    await click(container, 'Start Scan')
    await click(container, 'Create with Codex')

    expect(container.textContent).toContain('Cover image is required before minting')
    expect(container.textContent).toContain('Upload Cover Image')

    await click(container, 'Upload Cover Image')

    expect(pickCoverImage).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Cover ready: custom-cover.png')
    expect(container.textContent).toContain('Replace Cover')
  })

  it('hydrates a legacy saved draft without crashing when cover metadata is missing', async () => {
    const legacyDraft = { ...makeDraft() } as Record<string, unknown>
    delete legacyDraft.coverImageDataUrl
    delete legacyDraft.coverImageGenerated
    delete legacyDraft.creationSource

    await renderWithApi(createElectronApi({
      'desktop:create-draft:load': vi.fn().mockResolvedValue(legacyDraft as unknown as ExtractSoulDraft),
    }))

    expect(container.textContent).toContain('Create Soul Locally')
    expect(container.textContent).toContain('Cover image is required before minting')
    expect(container.textContent).toContain('Upload Cover Image')
  })

  it('keeps desktop mint auth lazy until the user explicitly opens it', async () => {
    await renderWithApi(createElectronApi({
      'desktop:create-draft:load': vi.fn().mockResolvedValue(makeDraft()),
      getDesktopRuntimeConfig: vi.fn().mockResolvedValue({
        suiNetwork: 'testnet',
        webBaseUrl: 'https://clawnews-mu.vercel.app',
        authReady: true,
        authBlocker: null,
      }),
    }))

    expect(container.textContent).toContain('Load Desktop Mint')
    expect(container.textContent).not.toContain('Mint on Sui')

    await click(container, 'Load Desktop Mint')

    expect(container.textContent).toContain('Mint on Sui')
  })

  it('shows the desktop wallet notice without leaking the raw env var name', async () => {
    await renderWithApi(createElectronApi({
      'extraction:get-openclaw-import-status': vi.fn().mockResolvedValue(makeOpenClawStatus({
        ready: false,
        soulFilePath: null,
        memoryFilePath: null,
        detail: 'OpenClaw workspace is missing SOUL.md.',
      })),
      'extraction:get-local-agent-statuses': vi.fn().mockResolvedValue(makeAgentStatuses([
        { agent: 'codex', status: 'available', detail: 'Ready.' },
      ])),
      getDesktopRuntimeConfig: vi.fn().mockResolvedValue({
        suiNetwork: 'testnet',
        webBaseUrl: 'https://clawnews-mu.vercel.app',
        authReady: false,
        authBlocker: 'The connected web deployment does not serve desktop wallet auth yet.',
      }),
    }))

    await click(container, 'Start Scan')
    await click(container, 'Create with Codex')

    expect(container.textContent).toContain('The connected web deployment does not serve desktop wallet auth yet.')
    // Make sure raw env var names never leak to UI copy. Using a regex avoids
    // putting the literal string in source (the no-residue test would flag it).
    expect(container.textContent ?? '').not.toMatch(/[A-Z_]+_PRIVY_APP_ID/)
  })
})
