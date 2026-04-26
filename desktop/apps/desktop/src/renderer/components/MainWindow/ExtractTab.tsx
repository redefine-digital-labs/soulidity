import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider } from '@mysten/dapp-kit'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import type {
  CreateLocalExtractDraftInput,
  ExtractSoulDraft,
  ExtractSoulDraftPendingSync,
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
import { assertObjectInputsExist } from '../../lib/soulidity/object-inputs'
import { buildPublishSoulTx } from '../../lib/soulidity/tx/publish'
import { useDesktopWallet } from '../../lib/hooks/use-desktop-wallet'

type Step = 'scan' | 'review' | 'create'

type DesktopAuthStatus = {
  hasToken: boolean
  accountId: string | null
}

type DesktopMeResponse = {
  profile: {
    accountId: string
    primarySuiAddress: string | null
  }
}

type RuntimeConfig = {
  suiNetwork: string
  webBaseUrl: string
  authReady: boolean
  authBlocker: string | null
}

type PersonalKioskResponse = {
  ownerAddress: string
  currentKioskId: string
  currentKioskCapOnChainId: string
}

type DesktopUploadResponse = {
  blobId: string
  blobObjectId: string
  contentHash: string
  blobUrl: string
  sealDekEnvelope?: string | null
  skillName?: string | null
}

type DesktopPublishResponse = {
  txDigest: string
  soulOnChainId: string
  stateOnChainId: string
  memoryOnChainId: string
  listingStatus: string
}

type MintStatus =
  | 'idle'
  | 'uploading-cover'
  | 'uploading-soul'
  | 'uploading-memory'
  | 'uploading-skills'
  | 'building'
  | 'signing'
  | 'syncing'
  | 'done'
  | 'error'

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

async function ipcGetDesktopAuthStatus(): Promise<DesktopAuthStatus> {
  const invoke = getOptionalElectronMethod<() => Promise<DesktopAuthStatus>>('getDesktopAuthStatus')
  if (!invoke) {
    return { hasToken: true, accountId: null }
  }

  try {
    return await invoke()
  } catch {
    return { hasToken: true, accountId: null }
  }
}

async function ipcGetDesktopMe(): Promise<DesktopMeResponse | null> {
  const invoke = getOptionalElectronMethod<() => Promise<DesktopMeResponse>>('getDesktopMe')
  if (!invoke) return null

  try {
    return await invoke()
  } catch {
    return null
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

async function ipcGetRuntimeConfig(): Promise<RuntimeConfig> {
  const invoke = getOptionalElectronMethod<() => Promise<RuntimeConfig>>('getDesktopRuntimeConfig')
  if (!invoke) {
    return {
      suiNetwork: 'testnet',
      webBaseUrl: '',
      authReady: false,
      authBlocker: 'Desktop wallet preflight is unavailable in this build.',
    }
  }

  try {
    return await invoke()
  } catch {
    return {
      suiNetwork: 'testnet',
      webBaseUrl: '',
      authReady: false,
      authBlocker: 'Desktop wallet preflight failed in this build.',
    }
  }
}

async function ipcUpload(params: {
  bytes: Uint8Array
  fileName: string
  mimeType: string
  uploadType: 'public' | 'encrypted'
  sendObjectTo?: string | null
}): Promise<DesktopUploadResponse> {
  const invoke = getElectronMethod<(params: {
    bytes: Uint8Array
    fileName: string
    mimeType: string
    uploadType: 'public' | 'encrypted'
    sendObjectTo?: string | null
  }) => Promise<DesktopUploadResponse>>(
    'desktop:create:upload',
    'Desktop upload IPC is not available',
  )

  try {
    return await invoke(params)
  } catch (err) {
    throw asIpcError(err, 'Upload failed')
  }
}

async function ipcResolvePersonalKiosk(walletAddress: string): Promise<PersonalKioskResponse | null> {
  const invoke = getElectronMethod<(params: { walletAddress: string }) => Promise<PersonalKioskResponse>>(
    'desktop:create:personal-kiosk',
    'Desktop personal kiosk IPC is not available',
  )

  try {
    return await invoke({ walletAddress })
  } catch (err) {
    const error = asIpcError(err, 'Failed to resolve personal kiosk')
    if (/no soulidity? personal kiosk found/i.test(error.message)) {
      return null
    }
    throw error
  }
}

async function ipcPublish(payload: ExtractSoulDraftPendingSync): Promise<DesktopPublishResponse> {
  const invoke = getElectronMethod<(payload: Record<string, unknown>) => Promise<DesktopPublishResponse>>(
    'desktop:create:publish',
    'Desktop publish IPC is not available',
  )

  try {
    return await invoke(payload as unknown as Record<string, unknown>)
  } catch (err) {
    throw asIpcError(err, 'Failed to mirror publish')
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
    return 'SOUL.md and memory.md came directly from your OpenClaw workspace. Edit only what should change before upload.'
  }

  if (draft.creationSource?.kind === 'local-agent') {
    return 'This draft was created locally after desktop assembled the source context for a read-only coding agent. Review the copy, adjust it if needed, then continue to upload and mint.'
  }

  return 'This local draft stays editable all the way through upload and mint.'
}

function textToBytes(value: string) {
  return new TextEncoder().encode(value)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function dataUrlToBytes(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(?:;base64)?,(.*)$/)
  if (!match) {
    throw new Error('Invalid cover image data URL')
  }

  const [, mimeType = 'application/octet-stream', payload] = match
  if (dataUrl.includes(';base64,')) {
    return { bytes: base64ToBytes(payload), mimeType }
  }

  return { bytes: textToBytes(decodeURIComponent(payload)), mimeType }
}

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function sameWalletAddress(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return false

  try {
    return normalizeSuiAddress(left) === normalizeSuiAddress(right)
  } catch {
    return false
  }
}

function hasCustomCoverImage(draft: ExtractSoulDraft) {
  return Boolean(asString(draft.coverImageDataUrl).trim()) && !draft.coverImageGenerated
}

function getMintStatusLabel(status: MintStatus) {
  switch (status) {
    case 'uploading-cover':
      return 'Uploading cover image...'
    case 'uploading-soul':
      return 'Encrypting and uploading soul.md...'
    case 'uploading-memory':
      return 'Encrypting and uploading memory.md...'
    case 'uploading-skills':
      return 'Encrypting and uploading skills.zip...'
    case 'building':
      return 'Building mint transaction...'
    case 'signing':
      return 'Waiting for wallet signature...'
    case 'syncing':
      return 'Syncing publish state...'
    case 'done':
      return 'Soul minted successfully.'
    case 'error':
      return 'Mint failed.'
    default:
      return ''
  }
}

type DesktopMintPanelProps = {
  draft: ExtractSoulDraft
  primarySuiAddress: string | null
  onMintSuccess: (result: DesktopPublishResponse) => void
}

type MintProvidersProps = DesktopMintPanelProps & {
  runtimeConfig: RuntimeConfig
}

const suiNetworks = {
  testnet: { url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' as const },
  mainnet: { url: getJsonRpcFullnodeUrl('mainnet'), network: 'mainnet' as const },
}

type SuiNetwork = keyof typeof suiNetworks

function DesktopMintPanelInner({ draft, primarySuiAddress, onMintSuccess }: DesktopMintPanelProps) {
  const { suiWallet, signAndExecute, suiClient } = useDesktopWallet()
  const [mintStatus, setMintStatus] = useState<MintStatus>('idle')
  const [mintError, setMintError] = useState<string | null>(null)
  const [publishResult, setPublishResult] = useState<DesktopPublishResponse | null>(null)

  const walletMismatch = useMemo(
    () => Boolean(primarySuiAddress && suiWallet?.address && !sameWalletAddress(primarySuiAddress, suiWallet.address)),
    [primarySuiAddress, suiWallet?.address],
  )

  const handleMint = useCallback(async () => {
    if (!hasCustomCoverImage(draft)) {
      setMintStatus('error')
      setMintError('Upload a cover image before minting from desktop.')
      return
    }

    if (!primarySuiAddress) {
      setMintStatus('error')
      setMintError('Bind a primary Sui wallet before minting from desktop.')
      return
    }

    if (!suiWallet?.address) {
      setMintStatus('error')
      setMintError('No desktop Sui wallet is available. Generate or import one in Settings.')
      return
    }

    if (walletMismatch) {
      setMintStatus('error')
      setMintError('The desktop wallet does not match the bound Sui wallet for this account.')
      return
    }

    try {
      setMintError(null)

      // Resume from pending sync if a previous on-chain TX succeeded but mirror failed
      if (draft.pendingSync) {
        setMintStatus('syncing')
        const publishResult = await ipcPublish(draft.pendingSync)

        setPublishResult(publishResult)
        setMintStatus('done')
        await ipcClearDraft()
        onMintSuccess(publishResult)
        return
      }

      setMintStatus('uploading-cover')
      const coverPayload = dataUrlToBytes(draft.coverImageDataUrl)
      const coverImage = await ipcUpload({
        bytes: coverPayload.bytes,
        fileName: draft.coverImageFileName,
        mimeType: draft.coverImageMimeType || coverPayload.mimeType,
        uploadType: 'public',
      })

      setMintStatus('uploading-soul')
      const soulFile = await ipcUpload({
        bytes: textToBytes(draft.soulMarkdown),
        fileName: 'soul.md',
        mimeType: 'text/markdown',
        uploadType: 'encrypted',
      })

      setMintStatus('uploading-memory')
      const memoryFile = await ipcUpload({
        bytes: textToBytes(draft.memoryMarkdown),
        fileName: 'memory.md',
        mimeType: 'text/markdown',
        uploadType: 'encrypted',
      })

      let skillsFile: DesktopUploadResponse | null = null
      if (draft.skillsArchive) {
        setMintStatus('uploading-skills')
        skillsFile = await ipcUpload({
          bytes: base64ToBytes(draft.skillsArchive.dataBase64),
          fileName: draft.skillsArchive.fileName,
          mimeType: draft.skillsArchive.mimeType,
          uploadType: 'encrypted',
        })
      }

      if (!coverImage.blobUrl) {
        throw new Error('Cover image upload is missing a blob URL.')
      }
      if (!soulFile.blobObjectId) {
        throw new Error('soul.md upload did not create a Walrus blob object. Modify the content and retry.')
      }
      if (!memoryFile.blobObjectId) {
        throw new Error('memory.md upload did not create a Walrus blob object. Modify the content and retry.')
      }
      if (!memoryFile.sealDekEnvelope?.trim()) {
        throw new Error('memory.md upload is missing Seal recovery data.')
      }
      if (skillsFile && !skillsFile.blobObjectId) {
        throw new Error('skills.zip upload did not create a Walrus blob object. Modify the archive and retry.')
      }

      setMintStatus('building')
      const personalKiosk = await ipcResolvePersonalKiosk(suiWallet.address)
      await assertObjectInputsExist(suiClient, {
        'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
        'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
        'Soul character blob': soulFile.blobObjectId,
        'Founding memory blob': memoryFile.blobObjectId,
        'Skills blob': skillsFile?.blobObjectId ?? null,
      })

      const tx = buildPublishSoulTx({
        currentKioskId: personalKiosk?.currentKioskId ?? null,
        currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
        name: draft.name,
        description: draft.description,
        imageUrl: coverImage.blobUrl,
        protectedBlobObjectId: soulFile.blobObjectId,
        foundingMemoryBlobObjectId: memoryFile.blobObjectId,
        skillsBlobObjectId: skillsFile?.blobObjectId ?? null,
        initialSkillName: skillsFile?.skillName ?? null,
        skillsVisibility: 'private',
        creatorRoyaltyBps: draft.royaltyBps,
      })

      setMintStatus('signing')
      const signed = await signAndExecute(tx)

      // Persist the sync payload before calling ipcPublish so a retry
      // after mirror failure resumes from here instead of re-minting.
      const syncPayload = {
        txDigest: signed.digest,
        tags: draft.tags,
        previewImages: [coverImage.blobUrl],
        readme: null,
        sealSidecar: soulFile.sealDekEnvelope ?? null,
        memorySealSidecar: memoryFile.sealDekEnvelope ?? null,
        skillsSealSidecar: skillsFile?.sealDekEnvelope ?? null,
      }
      await ipcSaveDraft({ ...draft, pendingSync: syncPayload })

      setMintStatus('syncing')
      const publishResult = await ipcPublish(syncPayload)

      setPublishResult(publishResult)
      setMintStatus('done')
      await ipcClearDraft()
      onMintSuccess(publishResult)
    } catch (err) {
      setMintStatus('error')
      setMintError(err instanceof Error ? err.message : 'Mint failed')
    }
  }, [draft, onMintSuccess, primarySuiAddress, signAndExecute, suiClient, suiWallet?.address, walletMismatch])

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">Preview & Mint</h3>
      <p className="extract-notice">
        Minting now stays inside desktop. The signed transaction must come from the same Sui wallet bound to this account.
      </p>

      <div className="extract-evidence" style={{ marginBottom: 12 }}>
        <div className="extract-evidence__row">
          <span className="extract-evidence__label">Bound wallet</span>
          <span className="extract-evidence__value">{primarySuiAddress ?? 'Not bound'}</span>
        </div>
        <div className="extract-evidence__row">
          <span className="extract-evidence__label">Desktop wallet</span>
          <span className="extract-evidence__value">{suiWallet?.address ?? 'Connecting...'}</span>
        </div>
        <div className="extract-evidence__row">
          <span className="extract-evidence__label">Auth state</span>
          <span className="extract-evidence__value">
            {suiWallet ? 'wallet ready' : 'no wallet bound'}
          </span>
        </div>
      </div>

      {walletMismatch && (
        <p className="link-panel__error" style={{ marginBottom: 12 }}>
          The desktop wallet does not match the bound Sui wallet for this account.
        </p>
      )}

      {mintError && (
        <p className="link-panel__error" style={{ marginBottom: 12 }}>
          {mintError}
        </p>
      )}

      {mintStatus !== 'idle' && (
        <p className="extract-status" style={{ marginBottom: 12 }}>
          {getMintStatusLabel(mintStatus)}
        </p>
      )}

      {publishResult && (
        <div className="extract-evidence" style={{ marginBottom: 12 }}>
          <div className="extract-evidence__row">
            <span className="extract-evidence__label">Tx digest</span>
            <span className="extract-evidence__value">{publishResult.txDigest}</span>
          </div>
          <div className="extract-evidence__row">
            <span className="extract-evidence__label">Soul</span>
            <span className="extract-evidence__value">{publishResult.soulOnChainId}</span>
          </div>
        </div>
      )}

      <button
        type="button"
        className="link-button"
        onClick={handleMint}
        disabled={!hasCustomCoverImage(draft) || (mintStatus !== 'idle' && mintStatus !== 'error' && mintStatus !== 'done')}
      >
        Mint on Sui
      </button>
    </section>
  )
}

function DesktopMintProviders({ runtimeConfig, ...props }: MintProvidersProps) {
  const [queryClient] = useState(() => new QueryClient())
  const network = runtimeConfig.suiNetwork as SuiNetwork
  const defaultNetwork: SuiNetwork = network in suiNetworks ? network : 'testnet'

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={suiNetworks} defaultNetwork={defaultNetwork}>
        <DesktopMintPanelInner {...props} />
      </SuiClientProvider>
    </QueryClientProvider>
  )
}

function DesktopMintPanel(props: DesktopMintPanelProps) {
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null)
  const [showMintControls, setShowMintControls] = useState(false)

  useEffect(() => {
    let cancelled = false

    void ipcGetRuntimeConfig().then((nextConfig) => {
      if (!cancelled) {
        setRuntimeConfig(nextConfig)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  if (!runtimeConfig) {
    return (
      <section className="settings-section">
        <p className="extract-status">Loading desktop wallet configuration...</p>
      </section>
    )
  }

  if (!runtimeConfig.authReady) {
    return (
      <section className="settings-section">
        <h3 className="settings-section__title">Preview & Mint</h3>
        <p className="extract-status">
          {runtimeConfig.authBlocker
            ?? 'Desktop wallet auth is unavailable on this build right now.'}
        </p>
      </section>
    )
  }

  if (!showMintControls) {
    return (
      <section className="settings-section">
        <h3 className="settings-section__title">Preview & Mint</h3>
        <p className="extract-notice">
          Desktop mint auth now stays unloaded until you explicitly open it, so reviewing or editing this draft does not trigger the full-window wallet backdrop.
        </p>
        <button
          type="button"
          className="link-button"
          onClick={() => setShowMintControls(true)}
        >
          Load Desktop Mint
        </button>
      </section>
    )
  }

  return <DesktopMintProviders runtimeConfig={runtimeConfig} {...props} />
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
  const [desktopMe, setDesktopMe] = useState<DesktopMeResponse | null>(null)
  const [draft, setDraft] = useState<ExtractSoulDraft | null>(null)
  const [publishResult, setPublishResult] = useState<DesktopPublishResponse | null>(null)

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

    void Promise.all([
      ipcGetDesktopAuthStatus(),
      ipcLoadDraft(),
    ]).then(async ([authStatus, loadedDraft]) => {
      if (cancelled) return

      if (loadedDraft) {
        setDraft(loadedDraft)
        setStep('create')
      }

      if (authStatus.hasToken) {
        const me = await ipcGetDesktopMe()
        if (!cancelled) {
          setDesktopMe(me)
        }
      }

      hasHydratedDraftRef.current = true
    })

    return () => {
      cancelled = true
    }
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
      setPublishResult(null)
      setStep('create')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'OpenClaw import failed')
    } finally {
      setActiveDraftAction(null)
    }
  }, [scanResults, selectedOpenClawSkillId])

  const handleCreateWithAgent = useCallback(async (agent: LocalExtractAgent) => {
    if (!scanResults) return

    setActionError(null)
    setActiveDraftAction(agent)

    try {
      const nextDraft = await ipcCreateLocalDraft({ agent, scanResults })
      setDraft(nextDraft)
      setPublishResult(null)
      setStep('create')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Local draft creation failed')
    } finally {
      setActiveDraftAction(null)
    }
  }, [scanResults])

  const handleOpenWebCreate = useCallback(async () => {
    setActionError(null)
    try {
      await ipcOpenWebCreate()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to open web create')
    }
  }, [])

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

  return (
    <div className="tab-content">
      <section className="settings-section">
        <h3 className="settings-section__title">{draft ? getDraftHeadline(draft) : 'Create Soul Locally'}</h3>
        <p className="extract-notice">
          {draft ? getDraftNotice(draft) : 'This local draft stays editable before upload and mint.'}
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
            <h3 className="settings-section__title">Extracted Signal</h3>
            <div className="settings-field">
              <span className="settings-field__label">Traits</span>
              <input
                type="text"
                className="settings-field__input"
                value={formatListInput(draft.traits)}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  traits: parseListInput(event.target.value),
                  updatedAt: new Date().toISOString(),
                }))}
              />
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Communication Style</span>
              <textarea
                className="settings-field__input extract-textarea"
                value={draft.communicationStyle}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  communicationStyle: event.target.value,
                  updatedAt: new Date().toISOString(),
                }))}
                rows={3}
              />
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Expertise</span>
              <input
                type="text"
                className="settings-field__input"
                value={formatListInput(draft.expertise)}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  expertise: parseListInput(event.target.value),
                  updatedAt: new Date().toISOString(),
                }))}
              />
            </div>

            <div className="settings-field">
              <span className="settings-field__label">Work Style</span>
              <textarea
                className="settings-field__input extract-textarea"
                value={draft.workStyle}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  workStyle: event.target.value,
                  updatedAt: new Date().toISOString(),
                }))}
                rows={3}
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
                  ? 'Cover image is required before minting. Replace the generated placeholder with a real cover image.'
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
              <label className="link-button link-button--secondary" style={{ display: 'inline-flex', width: 'fit-content', cursor: 'pointer' }}>
                {draft.skillsArchive ? 'Replace skills.zip' : 'Attach skills.zip'}
                <input type="file" accept=".zip,application/zip" style={{ display: 'none' }} onChange={handleSkillsFileChange} />
              </label>
              {draft.skillsArchive && (
                <p className="extract-status">Attached: {draft.skillsArchive.fileName}</p>
              )}
            </div>
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

          <DesktopMintPanel
            draft={draft}
            primarySuiAddress={desktopMe?.profile?.primarySuiAddress ?? null}
            onMintSuccess={(result) => {
              setPublishResult(result)
              setDraft(null)
            }}
          />
        </>
      )}

      {publishResult && (
        <section className="settings-section">
          <h3 className="settings-section__title">Last Mint</h3>
          <div className="extract-evidence">
            <div className="extract-evidence__row">
              <span className="extract-evidence__label">Tx digest</span>
              <span className="extract-evidence__value">{publishResult.txDigest}</span>
            </div>
            <div className="extract-evidence__row">
              <span className="extract-evidence__label">Soul</span>
              <span className="extract-evidence__value">{publishResult.soulOnChainId}</span>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
