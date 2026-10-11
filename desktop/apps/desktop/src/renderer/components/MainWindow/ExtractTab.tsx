import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CreateLocalExtractDraftDirection,
  CreateLocalExtractDraftInput,
  ExtractSoulDraft,
  ImportOpenClawDraftInput,
  LocalExtractAgent,
  LocalExtractAgentStatus,
  OpenClawImportStatus,
  SessionScanResult,
  ScanProgress,
} from '@soulidity/shared'
import {
  refreshExtractSoulDraftCover,
} from '@soulidity/shared'

type Step = 'scan' | 'review' | 'direction' | 'create'

function getElectronMethod<T extends (...args: any[]) => any>(name: string, missingMessage: string): T {
  const api = (window as any).electronAPI as Record<string, unknown> | undefined
  const method = api?.[name]
  if (typeof method !== 'function') {
    throw new Error(missingMessage)
  }
  return method as T
}

function getOptionalElectronMethod<T extends (...args: any[]) => any>(name: string): T | null {
  const api = (window as any).electronAPI as Record<string, unknown> | undefined
  const method = api?.[name]
  return typeof method === 'function' ? (method as T) : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry))
    : []
}

function normalizeToolUsageFrequency(value: unknown): Record<string, number> {
  const record = asRecord(value)
  if (!record) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
  )
}

function normalizeScanResult(result: SessionScanResult): SessionScanResult {
  const raw = asRecord(result)
  const features = asRecord(raw?.features)
  const scanPeriod = asRecord(raw?.scanPeriod)

  return {
    agentType:
      raw?.agentType === 'claude-code' || raw?.agentType === 'opencode'
        ? raw.agentType
        : 'codex',
    coverage: raw?.coverage === 'full' ? 'full' : 'partial',
    unsupportedMetrics: asStringArray(raw?.unsupportedMetrics),
    sessionCount: asNumber(raw?.sessionCount),
    totalTurns: asNumber(raw?.totalTurns),
    scanPeriod: {
      from: asNumber(scanPeriod?.from),
      to: asNumber(scanPeriod?.to),
    },
    sourceFiles: asStringArray(raw?.sourceFiles),
    features: {
      avgTurnsPerSession: asNumber(features?.avgTurnsPerSession),
      avgResponseLength: asNumber(features?.avgResponseLength),
      toolUsageFrequency: normalizeToolUsageFrequency(features?.toolUsageFrequency),
      topTools: asStringArray(features?.topTools),
      primaryLanguages: asStringArray(features?.primaryLanguages),
      avgSessionDurationMs: asNumber(features?.avgSessionDurationMs),
      peakHours: asNumberArray(features?.peakHours),
      usesCodeBlocks: typeof features?.usesCodeBlocks === 'boolean' ? features.usesCodeBlocks : false,
      avgCodeBlocksPerResponse: asNumber(features?.avgCodeBlocksPerResponse),
    },
  }
}

function normalizeCreationSource(value: unknown): ExtractSoulDraft['creationSource'] {
  const record = asRecord(value)
  if (!record) {
    return undefined
  }

  const kind = record.kind
  if (kind !== 'legacy-profile' && kind !== 'openclaw-import' && kind !== 'local-agent') {
    return undefined
  }

  const agent = record.agent === 'claude' || record.agent === 'codex' ? record.agent : undefined
  return {
    kind,
    label: asString(record.label, 'Create Soul Locally'),
    agent,
    workspacePath: typeof record.workspacePath === 'string' ? record.workspacePath : null,
  }
}

function normalizeSkillsArchive(value: unknown): ExtractSoulDraft['skillsArchive'] {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const fileName = asString(record.fileName)
  const dataBase64 = asString(record.dataBase64)
  if (!fileName || !dataBase64) {
    return null
  }

  return {
    fileName,
    mimeType: asString(record.mimeType, 'application/zip'),
    dataBase64,
  }
}

function normalizePendingSync(value: unknown): ExtractSoulDraft['pendingSync'] {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const txDigest = asString(record.txDigest)
  if (!txDigest) {
    return null
  }

  return {
    txDigest,
    tags: asStringArray(record.tags),
    previewImages: asStringArray(record.previewImages),
    readme: typeof record.readme === 'string' ? record.readme : null,
    sealSidecar: typeof record.sealSidecar === 'string' ? record.sealSidecar : null,
    memorySealSidecar: typeof record.memorySealSidecar === 'string' ? record.memorySealSidecar : null,
    skillsSealSidecar: typeof record.skillsSealSidecar === 'string' ? record.skillsSealSidecar : null,
  }
}

function inferCoverGenerated(record: Record<string, unknown>, coverImageFileName: string, coverImageMimeType: string) {
  if (typeof record.coverImageGenerated === 'boolean') {
    return record.coverImageGenerated
  }

  return coverImageFileName === 'extract-cover.svg' || coverImageMimeType === 'image/svg+xml'
}

function normalizeLoadedDraft(rawDraft: ExtractSoulDraft | null): ExtractSoulDraft | null {
  const record = asRecord(rawDraft)
  if (!record) {
    return null
  }

  const nowIso = new Date().toISOString()
  const sourceProfile = asRecord(record.sourceProfile)
  const personality = asRecord(sourceProfile?.personality)
  const suggested = asRecord(sourceProfile?.suggested)
  const sourceProfileEvidence = asRecord(sourceProfile?.evidence)
  const draftEvidence = asRecord(record.evidence)

  const traits = asStringArray(record.traits)
  const expertise = asStringArray(record.expertise)
  const tags = asStringArray(record.tags)
  const evidence = {
    sessionCount: asNumber(draftEvidence?.sessionCount ?? sourceProfileEvidence?.sessionCount),
    turnCount: asNumber(draftEvidence?.turnCount ?? sourceProfileEvidence?.turnCount),
    topTools: asStringArray(draftEvidence?.topTools ?? sourceProfileEvidence?.topTools),
    primaryLanguages: asStringArray(draftEvidence?.primaryLanguages ?? sourceProfileEvidence?.primaryLanguages),
    peakHours: asNumberArray(draftEvidence?.peakHours ?? sourceProfileEvidence?.peakHours),
  }

  const name = asString(record.name, asString(suggested?.name, 'Untitled Soul'))
  const description = asString(record.description, asString(suggested?.description))
  const coverImageFileName = asString(record.coverImageFileName, 'extract-cover.svg')
  const coverImageMimeType = asString(record.coverImageMimeType, 'image/svg+xml')

  const normalizedDraft = {
    version: 1,
    createdAt: asString(record.createdAt, nowIso),
    updatedAt: asString(record.updatedAt, nowIso),
    sourceProfile: {
      version: 1,
      personality: {
        traits: traits.length > 0 ? traits : asStringArray(personality?.traits),
        communicationStyle: asString(record.communicationStyle, asString(personality?.communicationStyle)),
        expertise: expertise.length > 0 ? expertise : asStringArray(personality?.expertise),
        workStyle: asString(record.workStyle, asString(personality?.workStyle)),
      },
      evidence,
      suggested: {
        name,
        description,
        tags: tags.length > 0 ? tags : asStringArray(suggested?.tags),
      },
    },
    creationSource: normalizeCreationSource(record.creationSource),
    name,
    description,
    tags: tags.length > 0 ? tags : asStringArray(suggested?.tags),
    royaltyBps: Math.max(0, Math.min(2500, asNumber(record.royaltyBps, 500))),
    traits: traits.length > 0 ? traits : asStringArray(personality?.traits),
    communicationStyle: asString(record.communicationStyle, asString(personality?.communicationStyle)),
    expertise: expertise.length > 0 ? expertise : asStringArray(personality?.expertise),
    workStyle: asString(record.workStyle, asString(personality?.workStyle)),
    evidence,
    coverImageDataUrl: asString(record.coverImageDataUrl),
    coverImageFileName,
    coverImageMimeType,
    coverImageGenerated: inferCoverGenerated(record, coverImageFileName, coverImageMimeType),
    coverImagePrompt: asString(record.coverImagePrompt),
    characterType: asString(record.characterType),
    extraDescription: asString(record.extraDescription),
    soulMarkdown: asString(record.soulMarkdown),
    memoryMarkdown: asString(record.memoryMarkdown),
    skillsArchive: normalizeSkillsArchive(record.skillsArchive),
    pendingSync: normalizePendingSync(record.pendingSync),
  } satisfies ExtractSoulDraft

  return refreshExtractSoulDraftCover(normalizedDraft, { nowIso: normalizedDraft.updatedAt })
}

function asIpcError(err: unknown, fallback: string): Error {
  if (err instanceof Error && err.message.trim()) return err
  return new Error(fallback)
}

async function ipcScanSessions(): Promise<SessionScanResult[]> {
  const invoke = getElectronMethod<() => Promise<SessionScanResult[]>>(
    'extraction:scan-sessions',
    'Scan IPC not available — is the companion up to date?',
  )

  try {
    const results = await invoke()
    return Array.isArray(results) ? results.map(normalizeScanResult) : []
  } catch (err) {
    throw asIpcError(err, 'Scan failed')
  }
}

async function ipcGetOpenClawImportStatus(): Promise<OpenClawImportStatus> {
  const invoke = getElectronMethod<() => Promise<OpenClawImportStatus>>(
    'extraction:get-openclaw-import-status',
    'OpenClaw import IPC not available — is the companion up to date?',
  )

  try {
    return await invoke()
  } catch (err) {
    throw asIpcError(err, 'Failed to inspect OpenClaw workspace')
  }
}

async function ipcGetLocalAgentStatuses(): Promise<LocalExtractAgentStatus[]> {
  const invoke = getElectronMethod<() => Promise<LocalExtractAgentStatus[]>>(
    'extraction:get-local-agent-statuses',
    'Local agent status IPC not available — is the companion up to date?',
  )

  try {
    return await invoke()
  } catch (err) {
    throw asIpcError(err, 'Failed to inspect local agent status')
  }
}

async function ipcImportOpenClawDraft(input: ImportOpenClawDraftInput): Promise<ExtractSoulDraft> {
  const invoke = getElectronMethod<(input: ImportOpenClawDraftInput) => Promise<ExtractSoulDraft>>(
    'extraction:import-openclaw-draft',
    'OpenClaw import IPC not available — is the companion up to date?',
  )

  try {
    return await invoke(input)
  } catch (err) {
    throw asIpcError(err, 'OpenClaw import failed')
  }
}

async function ipcCreateLocalDraft(input: CreateLocalExtractDraftInput): Promise<ExtractSoulDraft> {
  const invoke = getElectronMethod<(input: CreateLocalExtractDraftInput) => Promise<ExtractSoulDraft>>(
    'extraction:create-local-draft',
    'Local draft IPC not available — is the companion up to date?',
  )

  try {
    return await invoke(input)
  } catch (err) {
    throw asIpcError(err, 'Local draft creation failed')
  }
}

async function ipcOpenWebCreate(): Promise<void> {
  const invoke = getElectronMethod<() => Promise<void>>(
    'extraction:open-web-create',
    'Open web create IPC not available — is the companion up to date?',
  )

  try {
    return await invoke()
  } catch (err) {
    throw asIpcError(err, 'Failed to open web create')
  }
}

async function ipcStartMintHandoff(draft: ExtractSoulDraft): Promise<void> {
  const invoke = getElectronMethod<(draft: ExtractSoulDraft) => Promise<void>>(
    'extraction:start-mint-handoff',
    'Mint hand-off IPC not available — is the companion up to date?',
  )

  try {
    return await invoke(draft)
  } catch (err) {
    throw asIpcError(err, 'Failed to start mint hand-off')
  }
}

function ipcOnScanProgress(cb: (progress: ScanProgress) => void): () => void {
  try {
    const subscribe = getElectronMethod<(callback: (progress: ScanProgress) => void) => () => void>(
      'extraction:scan-progress',
      'Scan progress IPC not available',
    )
    return subscribe(cb)
  } catch {
    return () => {}
  }
}

async function ipcLoadDraft(): Promise<ExtractSoulDraft | null> {
  const invoke = getOptionalElectronMethod<() => Promise<ExtractSoulDraft | null>>('desktop:create-draft:load')
  if (!invoke) return null

  try {
    return normalizeLoadedDraft(await invoke())
  } catch {
    return null
  }
}

async function ipcSaveDraft(draft: ExtractSoulDraft): Promise<void> {
  const invoke = getOptionalElectronMethod<(draft: ExtractSoulDraft) => Promise<void>>('desktop:create-draft:save')
  if (!invoke) return
  await invoke(draft)
}

async function ipcClearDraft(): Promise<void> {
  const invoke = getOptionalElectronMethod<() => Promise<void>>('desktop:create-draft:clear')
  if (!invoke) return
  await invoke()
}

async function ipcPickCoverImage(): Promise<{ dataUrl: string; fileName: string; mimeType: string } | null> {
  const invoke = getOptionalElectronMethod<() => Promise<{ dataUrl: string; fileName: string; mimeType: string } | null>>(
    'desktop:create-draft:pick-cover-image',
  )
  if (!invoke) return null

  try {
    return await invoke()
  } catch (err) {
    throw asIpcError(err, 'Failed to select a cover image')
  }
}

function parseListInput(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatListInput(values: string[]) {
  return values.join(', ')
}

function formatHours(hours: number[]) {
  if (hours.length === 0) return '—'
  return hours.map((hour) => `${hour}:00`).join(', ')
}

function formatLocalAgentLabel(agent: LocalExtractAgent) {
  return agent === 'codex' ? 'Codex' : 'Claude'
}

function summarizeScanResults(results: SessionScanResult[] | null) {
  if (!results || results.length === 0) {
    return {
      sessionCount: 0,
      turnCount: 0,
      sourceFileCount: 0,
      topTools: [] as string[],
      primaryLanguages: [] as string[],
      peakHours: [] as number[],
      agents: [] as string[],
    }
  }

  const toolCounts = new Map<string, number>()
  const languages = new Set<string>()
  const hourCounts = new Map<number, number>()

  for (const result of results) {
    for (const [tool, count] of Object.entries(result.features.toolUsageFrequency)) {
      toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + count)
    }

    for (const language of result.features.primaryLanguages) {
      languages.add(language)
    }

    for (const hour of result.features.peakHours) {
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1)
    }
  }

  return {
    sessionCount: results.reduce((sum, result) => sum + result.sessionCount, 0),
    turnCount: results.reduce((sum, result) => sum + result.totalTurns, 0),
    sourceFileCount: results.reduce((sum, result) => sum + result.sourceFiles.length, 0),
    topTools: [...toolCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([tool]) => tool),
    primaryLanguages: [...languages].slice(0, 5),
    peakHours: [...hourCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([hour]) => hour),
    agents: results.map((result) => result.agentType),
  }
}

function getDraftHeadline(draft: ExtractSoulDraft) {
  return draft.creationSource?.label ?? 'Create Soul Locally'
}

function getDraftNotice(draft: ExtractSoulDraft) {
  if (draft.creationSource?.kind === 'openclaw-import') {
    return 'SOUL.md and memory.md came directly from your OpenClaw workspace. Edit only what should change before opening web create.'
  }

  if (draft.creationSource?.kind === 'local-agent') {
    return 'This draft was created locally after desktop assembled the source context for a read-only coding agent. Review the copy, adjust it if needed, then continue in web create.'
  }

  return 'This local draft stays editable until you continue in web create.'
}

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function hasCustomCoverImage(draft: ExtractSoulDraft) {
  return Boolean(asString(draft.coverImageDataUrl).trim()) && !draft.coverImageGenerated
}

export function ExtractTab(): React.JSX.Element {
  const [step, setStep] = useState<Step>('scan')
  const [scanResults, setScanResults] = useState<SessionScanResult[] | null>(null)
  const [scanProgress, setScanProgress] = useState<ScanProgress[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [isResolvingSources, setIsResolvingSources] = useState(false)
  const [sourceResolutionError, setSourceResolutionError] = useState<string | null>(null)
  const [openClawStatus, setOpenClawStatus] = useState<OpenClawImportStatus | null>(null)
  const [selectedOpenClawSkillId, setSelectedOpenClawSkillId] = useState('')
  const [localAgentStatuses, setLocalAgentStatuses] = useState<LocalExtractAgentStatus[]>([])
  const [activeDraftAction, setActiveDraftAction] = useState<'openclaw' | LocalExtractAgent | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [coverActionError, setCoverActionError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ExtractSoulDraft | null>(null)
  // Direction step (between review and create when the user picks a local
  // codex/claude agent). `pendingDirectionAgent` holds the agent the user
  // selected on the review screen; the actual LLM call is deferred until they
  // submit the Direction form so the user's character-type input becomes part
  // of the prompt context.
  const [pendingDirectionAgent, setPendingDirectionAgent] = useState<LocalExtractAgent | null>(null)
  const [directionCharacterType, setDirectionCharacterType] = useState('')
  const [directionExtraDescription, setDirectionExtraDescription] = useState('')
  const [directionError, setDirectionError] = useState<string | null>(null)
  const [coverPromptCopied, setCoverPromptCopied] = useState(false)

  const unsubRef = useRef<(() => void) | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasHydratedDraftRef = useRef(false)
  const scanSummary = useMemo(() => summarizeScanResults(scanResults), [scanResults])

  useEffect(() => {
    return () => {
      unsubRef.current?.()
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void ipcLoadDraft().then((loadedDraft) => {
      if (cancelled) return

      if (loadedDraft) {
        setDraft(loadedDraft)
        setStep('create')
      }

      hasHydratedDraftRef.current = true
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Listen for the deep-link mint-completed callback. The web `/create/gas`
  // page fires `soulidity://mint-completed?token=...` after a Mint By Web
  // hand-off finishes minting; the main process clears the on-disk draft and
  // emits `extraction:draft-cleared` here so the wizard resets to a clean
  // Scan step instead of leaving the user staring at a draft that no longer
  // matches anything (the Soul is already on-chain, in their wallet).
  useEffect(() => {
    const subscribe = getOptionalElectronMethod<
      (callback: (detail: { reason: string }) => void) => () => void
    >('extraction:on-draft-cleared')
    if (!subscribe) return
    return subscribe(() => {
      setStep('scan')
      setDraft(null)
      setScanResults(null)
      setScanProgress([])
      setScanError(null)
      setOpenClawStatus(null)
      setSelectedOpenClawSkillId('')
      setLocalAgentStatuses([])
      setActiveDraftAction(null)
      setActionError(null)
      setCoverActionError(null)
      setPendingDirectionAgent(null)
      setDirectionCharacterType('')
      setDirectionExtraDescription('')
      setDirectionError(null)
      setCoverPromptCopied(false)
      setSourceResolutionError(null)
    })
  }, [])

  useEffect(() => {
    if (!hasHydratedDraftRef.current || !draft) {
      return
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(() => {
      void ipcSaveDraft(draft)
    }, 120)

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [draft])

  const updateDraft = useCallback((recipe: (current: ExtractSoulDraft) => ExtractSoulDraft) => {
    setDraft((current) => (current ? recipe(current) : current))
  }, [])

  const refreshSourceOptions = useCallback(async () => {
    setIsResolvingSources(true)
    setSourceResolutionError(null)

    const [openClawResult, localAgentResult] = await Promise.allSettled([
      ipcGetOpenClawImportStatus(),
      ipcGetLocalAgentStatuses(),
    ])

    if (openClawResult.status === 'fulfilled') {
      setOpenClawStatus(openClawResult.value)
      setSelectedOpenClawSkillId((current) => {
        if (!current) return ''
        return openClawResult.value.validSkills.some((skill) => skill.id === current) ? current : ''
      })
    } else {
      setOpenClawStatus(null)
    }

    if (localAgentResult.status === 'fulfilled') {
      setLocalAgentStatuses(localAgentResult.value)
    } else {
      setLocalAgentStatuses([])
    }

    const errors = [
      openClawResult.status === 'rejected'
        ? openClawResult.reason instanceof Error
          ? openClawResult.reason.message
          : String(openClawResult.reason)
        : null,
      localAgentResult.status === 'rejected'
        ? localAgentResult.reason instanceof Error
          ? localAgentResult.reason.message
          : String(localAgentResult.reason)
        : null,
    ].filter(Boolean)

    setSourceResolutionError(errors.length > 0 ? errors.join(' ') : null)
    setIsResolvingSources(false)
  }, [])

  const handleStartScan = useCallback(async () => {
    setIsScanning(true)
    setScanError(null)
    setSourceResolutionError(null)
    setActionError(null)
    setScanProgress([])
    setScanResults(null)
    setOpenClawStatus(null)
    setLocalAgentStatuses([])
    setSelectedOpenClawSkillId('')

    unsubRef.current?.()
    unsubRef.current = ipcOnScanProgress((progress) => {
      setScanProgress((previous) => {
        const index = previous.findIndex((entry) => entry.agentType === progress.agentType)
        if (index >= 0) {
          const next = [...previous]
          next[index] = progress
          return next
        }
        return [...previous, progress]
      })
    })

    try {
      const results = await ipcScanSessions()
      setScanResults(results)
      setStep('review')
      await refreshSourceOptions()
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setIsScanning(false)
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [refreshSourceOptions])

  const handleImportOpenClaw = useCallback(async () => {
    if (!scanResults) return

    setActionError(null)
    setActiveDraftAction('openclaw')

    try {
      const nextDraft = await ipcImportOpenClawDraft({
        scanResults,
        skillId: selectedOpenClawSkillId || null,
      })
      setDraft(nextDraft)
      setStep('create')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'OpenClaw import failed')
    } finally {
      setActiveDraftAction(null)
    }
  }, [scanResults, selectedOpenClawSkillId])

  const handleCreateWithAgent = useCallback((agent: LocalExtractAgent) => {
    // The actual LLM call is deferred to the Direction step so the user's
    // character-type input can be folded into the prompt context.
    setActionError(null)
    setDirectionError(null)
    setPendingDirectionAgent(agent)
    setStep('direction')
  }, [])

  const handleBackToReviewFromDirection = useCallback(() => {
    setDirectionError(null)
    setStep('review')
  }, [])

  const handleSubmitDirection = useCallback(async () => {
    if (!scanResults) return
    if (!pendingDirectionAgent) return
    const characterType = directionCharacterType.trim()
    if (!characterType) {
      setDirectionError('Character type is required.')
      return
    }
    setDirectionError(null)
    setActiveDraftAction(pendingDirectionAgent)

    try {
      const direction: CreateLocalExtractDraftDirection = {
        characterType,
        extraDescription: directionExtraDescription.trim(),
      }
      const nextDraft = await ipcCreateLocalDraft({
        agent: pendingDirectionAgent,
        scanResults,
        direction,
      })
      setDraft(nextDraft)
      setStep('create')
    } catch (err) {
      setDirectionError(err instanceof Error ? err.message : 'Local draft creation failed')
    } finally {
      setActiveDraftAction(null)
    }
  }, [scanResults, pendingDirectionAgent, directionCharacterType, directionExtraDescription])

  const handleCopyCoverPrompt = useCallback(async () => {
    if (!draft?.coverImagePrompt) return
    try {
      await navigator.clipboard.writeText(draft.coverImagePrompt)
      setCoverPromptCopied(true)
      window.setTimeout(() => setCoverPromptCopied(false), 1500)
    } catch {
      // Clipboard write may fail in restrictive contexts (e.g. older webviews).
      // Silently no-op; the textarea content is still visible for manual copy.
    }
  }, [draft?.coverImagePrompt])

  const handleOpenWebCreate = useCallback(async () => {
    setActionError(null)
    try {
      await ipcOpenWebCreate()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to open web create')
    }
  }, [])

  const [isStartingMintHandoff, setIsStartingMintHandoff] = useState(false)
  const handleStartMintHandoff = useCallback(async () => {
    if (!draft) return
    setActionError(null)
    setIsStartingMintHandoff(true)
    try {
      await ipcStartMintHandoff(draft)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start mint hand-off')
    } finally {
      setIsStartingMintHandoff(false)
    }
  }, [draft])

  const handlePickCoverImage = useCallback(async () => {
    setCoverActionError(null)
    try {
      const result = await ipcPickCoverImage()
      if (!result) return

      updateDraft((current) => ({
        ...current,
        coverImageDataUrl: result.dataUrl,
        coverImageFileName: result.fileName,
        coverImageMimeType: result.mimeType || 'application/octet-stream',
        coverImageGenerated: false,
        updatedAt: new Date().toISOString(),
      }))
    } catch (err) {
      setCoverActionError(err instanceof Error ? err.message : 'Failed to replace cover image')
    }
  }, [updateDraft])

  const handleSkillsFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const dataBase64 = await fileToBase64(file)
      updateDraft((current) => ({
        ...current,
        skillsArchive: {
          fileName: file.name,
          mimeType: file.type || 'application/zip',
          dataBase64,
        },
        updatedAt: new Date().toISOString(),
      }))
    } finally {
      event.target.value = ''
    }
  }, [updateDraft])

  const renderProgressItem = (progress: ScanProgress) => {
    const statusLabel =
      progress.phase === 'discovering' ? 'Discovering...' :
      progress.phase === 'parsing' ? `Parsing ${progress.filesParsed}/${progress.filesFound}` :
      progress.phase === 'aggregating' ? 'Aggregating...' :
      progress.phase === 'complete' ? `Done (${progress.filesParsed} files)` :
      progress.error || 'Error'

    const statusClass =
      progress.phase === 'complete' ? 'agent-card__status--completed' :
      progress.phase === 'error' ? 'agent-card__status--error' :
      'agent-card__status--working'

    return (
      <div key={progress.agentType} className="agent-card" style={{ marginBottom: 6 }}>
        <div className="agent-card__header">
          <span className="agent-card__type">{progress.agentType}</span>
          <span className={`agent-card__status ${statusClass}`}>{statusLabel}</span>
        </div>
      </div>
    )
  }

  if (step === 'scan') {
    return (
      <div className="tab-content">
        <section className="settings-section">
          <h3 className="settings-section__title">Extract Your Coding DNA</h3>
          <p className="extract-notice">
            Extract scans local session history, checks for an OpenClaw workspace, and then lets you import local files, create with Codex or Claude using desktop-prepared context, or fall back to the web create flow.
          </p>

          {!isScanning && !scanResults && (
            <button type="button" className="link-button" onClick={handleStartScan}>
              Start Scan
            </button>
          )}

          {isScanning && (
            <div style={{ marginTop: 12 }}>
              {scanProgress.map(renderProgressItem)}
              {scanProgress.length === 0 && (
                <p className="extract-status">Starting scan...</p>
              )}
            </div>
          )}

          {scanError && (
            <div style={{ marginTop: 12 }}>
              <p className="link-panel__error">{scanError}</p>
              <button type="button" className="link-button" onClick={handleStartScan}>
                Retry
              </button>
            </div>
          )}
        </section>
      </div>
    )
  }

  if (step === 'review') {
    const availableAgents = localAgentStatuses.filter((status) => status.status === 'available')
    const showWebCreate = !openClawStatus?.ready && availableAgents.length === 0

    return (
      <div className="tab-content">
        <section className="settings-section">
          <h3 className="settings-section__title">Scan Evidence</h3>
          <div className="extract-evidence">
            <div className="extract-evidence__row">
              <span className="extract-evidence__label">Sessions</span>
              <span className="extract-evidence__value">{scanSummary.sessionCount}</span>
            </div>
            <div className="extract-evidence__row">
              <span className="extract-evidence__label">Turns</span>
              <span className="extract-evidence__value">{scanSummary.turnCount}</span>
            </div>
            <div className="extract-evidence__row">
              <span className="extract-evidence__label">Source files</span>
              <span className="extract-evidence__value">{scanSummary.sourceFileCount}</span>
            </div>
            <div className="extract-evidence__row">
              <span className="extract-evidence__label">Agents</span>
              <span className="extract-evidence__value">{scanSummary.agents.join(', ') || '—'}</span>
            </div>
            <div className="extract-evidence__row">
              <span className="extract-evidence__label">Top Tools</span>
              <span className="extract-evidence__value">{scanSummary.topTools.join(', ') || '—'}</span>
            </div>
            <div className="extract-evidence__row">
              <span className="extract-evidence__label">Languages</span>
              <span className="extract-evidence__value">{scanSummary.primaryLanguages.join(', ') || '—'}</span>
            </div>
            <div className="extract-evidence__row">
              <span className="extract-evidence__label">Peak Hours</span>
              <span className="extract-evidence__value">{formatHours(scanSummary.peakHours)}</span>
            </div>
          </div>
          {scanSummary.sessionCount === 0 && (
            <p className="extract-status">No supported session logs were found. OpenClaw import or web create can still continue if available.</p>
          )}
        </section>

        <section className="settings-section">
          <h3 className="settings-section__title">OpenClaw Import</h3>
          {isResolvingSources && !openClawStatus ? (
            <p className="extract-status">Checking for an OpenClaw workspace...</p>
          ) : openClawStatus ? (
            <>
              <div className="extract-evidence">
                <div className="extract-evidence__row">
                  <span className="extract-evidence__label">Workspace</span>
                  <span className="extract-evidence__value">{openClawStatus.workspacePath ?? 'Not detected'}</span>
                </div>
                <div className="extract-evidence__row">
                  <span className="extract-evidence__label">State</span>
                  <span className="extract-evidence__value">{openClawStatus.ready ? 'Ready to import' : openClawStatus.detected ? 'Partial workspace' : 'Not detected'}</span>
                </div>
                <div className="extract-evidence__row">
                  <span className="extract-evidence__label">SOUL.md</span>
                  <span className="extract-evidence__value">{openClawStatus.soulFilePath ?? 'Missing'}</span>
                </div>
                <div className="extract-evidence__row">
                  <span className="extract-evidence__label">memory.md</span>
                  <span className="extract-evidence__value">{openClawStatus.memoryFilePath ?? 'Missing'}</span>
                </div>
                <div className="extract-evidence__row">
                  <span className="extract-evidence__label">Valid skills</span>
                  <span className="extract-evidence__value">{openClawStatus.validSkills.length}</span>
                </div>
              </div>
              <p className="extract-status">{openClawStatus.detail}</p>

              {openClawStatus.validSkills.length > 1 && (
                <div className="settings-field">
                  <span className="settings-field__label">Optional skill bundle</span>
                  <select
                    className="settings-field__input"
                    value={selectedOpenClawSkillId}
                    onChange={(event) => setSelectedOpenClawSkillId(event.target.value)}
                  >
                    <option value="">No skills bundle</option>
                    {openClawStatus.validSkills.map((skill) => (
                      <option key={skill.id} value={skill.id}>
                        {skill.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {openClawStatus.validSkills.length === 1 && (
                <p className="extract-status">Skills bundle will be attached automatically from {openClawStatus.validSkills[0]?.label}.</p>
              )}
            </>
          ) : (
            <p className="extract-status">OpenClaw inspection has not run yet.</p>
          )}
        </section>

        <section className="settings-section">
          <h3 className="settings-section__title">Local Agents</h3>
          <p className="extract-notice">
            Desktop now prepares the local context before invoking Codex or Claude in read-only mode, so this flow should not trigger per-file permission prompts.
          </p>
          {isResolvingSources && localAgentStatuses.length === 0 ? (
            <p className="extract-status">Checking local Codex and Claude CLI availability...</p>
          ) : (
            <div className="extract-option-grid">
              {localAgentStatuses.map((status) => {
                const statusLabel =
                  status.status === 'available' ? 'Ready' :
                  status.status === 'not-installed' ? 'Not installed' :
                  status.status === 'not-authenticated' ? 'Needs login' :
                  'Unavailable'
                const statusClass =
                  status.status === 'available' ? 'agent-card__status--completed' :
                  status.status === 'not-authenticated' ? 'agent-card__status--needs-attention' :
                  'agent-card__status--error'

                return (
                  <div key={status.agent} className="agent-card">
                    <div className="agent-card__header">
                      <span className="agent-card__type">{formatLocalAgentLabel(status.agent)}</span>
                      <span className={`agent-card__status ${statusClass}`}>{statusLabel}</span>
                    </div>
                    <div className="agent-card__detail" title={status.detail}>{status.detail}</div>
                  </div>
                )
              })}

              {localAgentStatuses.length === 0 && (
                <p className="extract-status">No local CLI status is available yet.</p>
              )}
            </div>
          )}
        </section>

        {sourceResolutionError && (
          <section className="settings-section">
            <p className="link-panel__error">{sourceResolutionError}</p>
          </section>
        )}

        {actionError && (
          <section className="settings-section">
            <p className="link-panel__error">{actionError}</p>
          </section>
        )}

        <section className="settings-section extract-actions">
          {openClawStatus?.ready && (
            <button
              type="button"
              className="link-button"
              onClick={handleImportOpenClaw}
              disabled={activeDraftAction !== null}
            >
              {activeDraftAction === 'openclaw' ? 'Importing OpenClaw Files...' : 'Import OpenClaw Files'}
            </button>
          )}

          {availableAgents.map((status) => (
            <button
              key={status.agent}
              type="button"
              className="link-button"
              onClick={() => { void handleCreateWithAgent(status.agent) }}
              disabled={activeDraftAction !== null}
            >
              {activeDraftAction === status.agent
                ? `Creating with ${formatLocalAgentLabel(status.agent)}...`
                : `Create with ${formatLocalAgentLabel(status.agent)}`}
            </button>
          ))}

          {showWebCreate && (
            <button
              type="button"
              className="link-button link-button--secondary"
              onClick={() => { void handleOpenWebCreate() }}
              disabled={activeDraftAction !== null}
            >
              Open Web Create
            </button>
          )}

          <button type="button" className="link-button link-button--secondary" onClick={handleStartScan} disabled={isScanning || isResolvingSources || activeDraftAction !== null}>
            Re-scan
          </button>
        </section>
      </div>
    )
  }

  if (step === 'direction') {
    const agentLabel = pendingDirectionAgent ? formatLocalAgentLabel(pendingDirectionAgent) : 'agent'
    const characterTypeReady = directionCharacterType.trim().length > 0
    const isGenerating = activeDraftAction === pendingDirectionAgent && pendingDirectionAgent !== null
    return (
      <div className="tab-content">
        <section className="settings-section">
          <h3 className="settings-section__title">Direction</h3>
          <p className="extract-notice">
            Tell {agentLabel} the character you want before it starts drafting. Your direction is folded into the prompt as the primary anchor; local-session evidence becomes supporting context.
          </p>
        </section>

        <section className="settings-section">
          <div className="settings-field">
            <span className="settings-field__label">Character Type *</span>
            <textarea
              className="settings-field__input extract-textarea"
              value={directionCharacterType}
              onChange={(event) => setDirectionCharacterType(event.target.value)}
              rows={2}
              maxLength={200}
              placeholder="e.g. AI Coder · Mentor · Strategist · Researcher"
              disabled={isGenerating}
            />
          </div>

          <div className="settings-field">
            <span className="settings-field__label">Additional Notes (optional)</span>
            <textarea
              className="settings-field__input extract-textarea"
              value={directionExtraDescription}
              onChange={(event) => setDirectionExtraDescription(event.target.value)}
              rows={5}
              maxLength={1000}
              placeholder="Style, vibe, palette hints, or anything else the agent should bias the draft toward."
              disabled={isGenerating}
            />
          </div>
        </section>

        {directionError && (
          <section className="settings-section">
            <p className="link-panel__error">{directionError}</p>
          </section>
        )}

        <section className="settings-section extract-actions">
          <button
            type="button"
            className="link-button link-button--secondary"
            onClick={handleBackToReviewFromDirection}
            disabled={isGenerating}
          >
            Back
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => { void handleSubmitDirection() }}
            disabled={!characterTypeReady || isGenerating || !pendingDirectionAgent}
          >
            {isGenerating ? `Generating with ${agentLabel}...` : `Generate Draft with ${agentLabel}`}
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="tab-content">
      <section className="settings-section">
        <h3 className="settings-section__title">{draft ? getDraftHeadline(draft) : 'Create Soul Locally'}</h3>
        <p className="extract-notice">
          {draft ? getDraftNotice(draft) : 'This local draft stays editable before web create.'}
        </p>
      </section>

      {draft && (
        <>
          {draft.creationSource && (
            <section className="settings-section">
              <div className="extract-evidence">
                <div className="extract-evidence__row">
                  <span className="extract-evidence__label">Source</span>
                  <span className="extract-evidence__value">{draft.creationSource.label}</span>
                </div>
                {draft.creationSource.workspacePath && (
                  <div className="extract-evidence__row">
                    <span className="extract-evidence__label">Workspace</span>
                    <span className="extract-evidence__value">{draft.creationSource.workspacePath}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="settings-section">
            <h3 className="settings-section__title">Basic Info</h3>
            <div className="settings-field">
              <span className="settings-field__label">Name</span>
              <input
                type="text"
                className="settings-field__input"
                value={draft.name}
                onChange={(event) => updateDraft((current) => ({
                  ...refreshExtractSoulDraftCover({
                    ...current,
                    name: event.target.value,
                    updatedAt: new Date().toISOString(),
                  }, { nowIso: new Date().toISOString() }),
                }))}
                maxLength={100}
              />
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Description</span>
              <textarea
                className="settings-field__input extract-textarea"
                value={draft.description}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  description: event.target.value,
                  updatedAt: new Date().toISOString(),
                }))}
                rows={3}
                maxLength={500}
              />
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Tags (comma-separated)</span>
              <input
                type="text"
                className="settings-field__input"
                value={formatListInput(draft.tags)}
                onChange={(event) => updateDraft((current) => ({
                  ...refreshExtractSoulDraftCover({
                    ...current,
                    tags: parseListInput(event.target.value),
                    updatedAt: new Date().toISOString(),
                  }, { nowIso: new Date().toISOString() }),
                }))}
              />
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Royalty (bps)</span>
              <input
                type="number"
                className="settings-field__input"
                value={draft.royaltyBps}
                min={0}
                max={2500}
                step={50}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  royaltyBps: Math.max(0, Math.min(2500, Number(event.target.value || 0))),
                  updatedAt: new Date().toISOString(),
                }))}
              />
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">Living Content</h3>
            <div className="settings-field">
              <span className="settings-field__label">soul.md</span>
              <textarea
                className="settings-field__input extract-textarea"
                value={draft.soulMarkdown}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  soulMarkdown: event.target.value,
                  updatedAt: new Date().toISOString(),
                }))}
                rows={10}
              />
            </div>

            <div className="settings-field">
              <span className="settings-field__label">memory.md</span>
              <textarea
                className="settings-field__input extract-textarea"
                value={draft.memoryMarkdown}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  memoryMarkdown: event.target.value,
                  updatedAt: new Date().toISOString(),
                }))}
                rows={8}
              />
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">Cover & Skills</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {draft.coverImageDataUrl ? (
                <img
                  src={draft.coverImageDataUrl}
                  alt={draft.name}
                  style={{
                    width: '100%',
                    maxWidth: 240,
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                />
              ) : (
                <div className="extract-cover-placeholder">
                  No cover image selected yet.
                </div>
              )}
              <p className={!hasCustomCoverImage(draft) ? 'link-panel__error' : 'extract-status'}>
                {!hasCustomCoverImage(draft)
                  ? 'Cover image is required before web create. Replace the generated placeholder with a real cover image.'
                  : `Cover ready: ${draft.coverImageFileName}`}
              </p>
              {coverActionError && (
                <p className="link-panel__error">{coverActionError}</p>
              )}
              <button
                type="button"
                className="link-button link-button--secondary"
                style={{ display: 'inline-flex', width: 'fit-content' }}
                onClick={() => { void handlePickCoverImage() }}
              >
                {hasCustomCoverImage(draft) ? 'Replace Cover' : 'Upload Cover Image'}
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <span className="settings-field__label" style={{ margin: 0 }}>Cover Image Prompt</span>
                  <button
                    type="button"
                    className="link-button link-button--secondary"
                    style={{ display: 'inline-flex', width: 'fit-content', padding: '4px 10px', fontSize: 12 }}
                    onClick={() => { void handleCopyCoverPrompt() }}
                    disabled={!draft.coverImagePrompt}
                  >
                    {coverPromptCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <textarea
                  className="settings-field__input extract-textarea"
                  value={draft.coverImagePrompt}
                  onChange={(event) => updateDraft((current) => ({
                    ...current,
                    coverImagePrompt: event.target.value,
                    updatedAt: new Date().toISOString(),
                  }))}
                  rows={6}
                  placeholder="Not generated yet. Re-create the draft via Direction step, or write a 120-220 word English image-gen prompt manually."
                />
                <p className="extract-status" style={{ fontSize: 11, opacity: 0.7, margin: 0 }}>
                  Paste this prompt into DALL-E · Midjourney · Stable Diffusion · FLUX · Gemini Studio to generate a 1:1 cover, then upload the PNG above.
                </p>
              </div>
              <label className="link-button link-button--secondary" style={{ display: 'inline-flex', width: 'fit-content', cursor: 'pointer' }}>
                {draft.skillsArchive ? 'Replace skills.zip' : 'Attach skills.zip'}
                <input type="file" accept=".zip,application/zip" style={{ display: 'none' }} onChange={handleSkillsFileChange} />
              </label>
              {draft.skillsArchive && (
                <p className="extract-status">Attached: {draft.skillsArchive.fileName}</p>
              )}
            </div>
          </section>

          <section className="settings-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/*
              Mint Directly is intentionally absent. Desktop's local Sui keypair
              is the agent-wallet (auto-generated per install) and is *not* the
              user's main wallet — using it to sign the mint PTB would land the
              Soul on the agent address, violating the "Single wallet per user"
              system invariant in CLAUDE.md and hiding the Soul from the user's
              market view. Mint stays on web until desktop has user-main-wallet
              signing.

              Mint By Web POSTs the draft (text fields + cover dataURL +
              skills.zip base64) to /api/desktop/mint-handoff and opens the web
              /create page with a one-shot token; the web side hydrates the
              CreateSoulProvider so the user only signs and pays for Walrus +
              mint via their browser wallet.
            */}
            <button
              type="button"
              className="link-button"
              onClick={() => { void handleStartMintHandoff() }}
              style={{ width: '100%' }}
              disabled={!hasCustomCoverImage(draft) || isStartingMintHandoff}
              title={
                !hasCustomCoverImage(draft)
                  ? 'Upload a real cover image (PNG / JPEG / WebP) before continuing.'
                  : undefined
              }
            >
              {isStartingMintHandoff ? 'Sending draft to web...' : 'Mint By Web'}
            </button>
            {!hasCustomCoverImage(draft) && (
              <p className="extract-status" style={{ margin: 0, fontSize: 12 }}>
                Upload a real cover image first — Mint By Web needs it to skip the cover step on the web side.
              </p>
            )}
            {actionError && (
              <p className="link-panel__error" style={{ margin: 0 }}>{actionError}</p>
            )}
          </section>

          <section className="settings-section" style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="link-button link-button--secondary"
              onClick={() => setStep('review')}
              style={{ flex: 1 }}
            >
              Back
            </button>
          </section>
        </>
      )}
    </div>
  )
}
