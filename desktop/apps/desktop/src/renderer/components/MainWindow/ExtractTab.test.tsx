// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtractSoulDraft, LocalExtractAgentStatus, OpenClawImportStatus, SessionScanResult } from '@soulidity/shared'
import { ExtractTab } from './ExtractTab'

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
    coverImagePrompt: '',
    characterType: '',
    extraDescription: '',
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
  | 'extraction:scan-sessions'
  | 'extraction:get-openclaw-import-status'
  | 'extraction:get-local-agent-statuses'
  | 'extraction:import-openclaw-draft'
  | 'extraction:create-local-draft'
  | 'extraction:open-web-create'
  | 'extraction:start-mint-handoff'
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
    'extraction:start-mint-handoff': vi.fn().mockResolvedValue(undefined),
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

async function setTextareaByLabel(container: HTMLDivElement, labelText: string, value: string) {
  const labels = Array.from(container.querySelectorAll('span.settings-field__label'))
  const label = labels.find((node) => node.textContent === labelText)
  expect(label).toBeTruthy()
  const textarea = label!.parentElement!.querySelector('textarea') as HTMLTextAreaElement | null
  expect(textarea).toBeTruthy()
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(textarea!, value)
    textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    await flushEffects()
    await flushEffects()
  })
}

async function submitDirectionWithCharacterType(container: HTMLDivElement, agentLabel: string, characterType = 'AI Coder') {
  await setTextareaByLabel(container, 'Character Type *', characterType)
  await click(container, `Generate Draft with ${agentLabel}`)
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
    // Direction step is now interposed between source-selection and the LLM
    // call so the user can name the character before the agent drafts.
    await submitDirectionWithCharacterType(container, 'Codex', 'AI Coder')

    expect(createLocalDraft).toHaveBeenCalledWith({
      agent: 'codex',
      scanResults: [makeScanResult()],
      direction: {
        characterType: 'AI Coder',
        extraDescription: '',
      },
    })
    expect(container.textContent).toContain('Created with Codex')
    const nameInput = container.querySelector('input[type="text"]') as HTMLInputElement | null
    expect(nameInput?.value).toBe('Codex Draft')
  })

  it('disables Generate Draft on the Direction step until a character type is entered', async () => {
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
    }))

    await click(container, 'Start Scan')
    await click(container, 'Create with Codex')

    const findGenerateButton = () => Array.from(container.querySelectorAll('button'))
      .find((node) => node.textContent?.includes('Generate Draft with Codex')) as HTMLButtonElement | undefined

    const initialButton = findGenerateButton()
    expect(initialButton?.disabled).toBe(true)

    await setTextareaByLabel(container, 'Character Type *', 'AI Coder')

    const enabledButton = findGenerateButton()
    expect(enabledButton?.disabled).toBe(false)
  })

  it('renders the LLM cover image prompt on the Review step and lets the user edit it', async () => {
    const llmCoverPrompt = 'A square cyberpunk illustration of a coder silhouette on a neon-lit rooftop at dusk; magenta and teal palette; cinematic backlight; no close-up faces.'
    const createLocalDraft = vi.fn().mockResolvedValue(makeDraft({
      creationSource: { kind: 'local-agent', label: 'Created with Codex', agent: 'codex' },
      name: 'Codex Draft',
      coverImagePrompt: llmCoverPrompt,
      characterType: 'AI Coder',
      extraDescription: 'cyberpunk',
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
      ])),
      'extraction:create-local-draft': createLocalDraft,
    }))

    await click(container, 'Start Scan')
    await click(container, 'Create with Codex')
    await submitDirectionWithCharacterType(container, 'Codex', 'AI Coder')

    expect(container.textContent).toContain('Cover Image Prompt')
    const textareas = Array.from(container.querySelectorAll('textarea')) as HTMLTextAreaElement[]
    const promptTextarea = textareas.find((node) => node.value === llmCoverPrompt)
    expect(promptTextarea).toBeTruthy()

    // Edit the cover prompt — the textarea is reactive against draft state and
    // must reflect manual overrides. This guards against the cover prompt being
    // accidentally bound read-only in a future refactor.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(promptTextarea!, 'Manual override prompt')
      promptTextarea!.dispatchEvent(new Event('input', { bubbles: true }))
      await flushEffects()
    })

    const updatedTextareas = Array.from(container.querySelectorAll('textarea')) as HTMLTextAreaElement[]
    expect(updatedTextareas.some((node) => node.value === 'Manual override prompt')).toBe(true)
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
    await submitDirectionWithCharacterType(container, 'Codex')

    expect(container.textContent).toContain('Cover image is required before web create')
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
    expect(container.textContent).toContain('Cover image is required before web create')
    expect(container.textContent).toContain('Upload Cover Image')
  })

  it('Mint By Web is gated on a real cover image and triggers the mint hand-off IPC', async () => {
    const startMintHandoff = vi.fn().mockResolvedValue(undefined)

    // Default makeDraft uses the generated SVG placeholder, which the
    // hand-off rejects. Stub a draft with a real cover so the button is
    // enabled and the IPC call can be observed.
    const draftWithRealCover = makeDraft({
      coverImageDataUrl: 'data:image/png;base64,UE5HUkVBTA==',
      coverImageFileName: 'real-cover.png',
      coverImageMimeType: 'image/png',
      coverImageGenerated: false,
    })

    await renderWithApi(createElectronApi({
      'desktop:create-draft:load': vi.fn().mockResolvedValue(draftWithRealCover),
      'extraction:start-mint-handoff': startMintHandoff,
    }))

    expect(container.textContent).toContain('Mint By Web')
    expect(container.textContent).not.toContain('Mint Directly')
    expect(container.textContent).not.toContain('Load Desktop Mint')
    expect(container.textContent).not.toContain('Mint on Sui')

    const button = Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.includes('Mint By Web')) as HTMLButtonElement
    expect(button.disabled).toBe(false)

    await click(container, 'Mint By Web')

    expect(startMintHandoff).toHaveBeenCalledTimes(1)
    const arg = startMintHandoff.mock.calls[0]?.[0] as { coverImageMimeType: string; name: string }
    expect(arg.coverImageMimeType).toBe('image/png')
    expect(arg.name).toBe(draftWithRealCover.name)
  })

  it('Mint By Web is disabled while the saved draft still has the SVG placeholder cover', async () => {
    const startMintHandoff = vi.fn().mockResolvedValue(undefined)
    // Default makeDraft has coverImageGenerated: true + image/svg+xml.
    await renderWithApi(createElectronApi({
      'desktop:create-draft:load': vi.fn().mockResolvedValue(makeDraft()),
      'extraction:start-mint-handoff': startMintHandoff,
    }))

    const button = Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.includes('Mint By Web')) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(container.textContent).toContain('Upload a real cover image first')

    await click(container, 'Mint By Web')
    expect(startMintHandoff).not.toHaveBeenCalled()
  })

  it('does not expose the retired desktop mint path for new local drafts', async () => {
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
    }))

    await click(container, 'Start Scan')
    await click(container, 'Create with Codex')
    await submitDirectionWithCharacterType(container, 'Codex')

    expect(container.textContent).toContain('Mint By Web')
    expect(container.textContent).not.toContain('Mint Directly')
    expect(container.textContent).not.toContain('Desktop wallet auth')
    expect(container.textContent).not.toContain('Mint on Sui')
    expect(container.textContent ?? '').not.toMatch(/[A-Z_]+_PRIVY_APP_ID/)
  })
})
