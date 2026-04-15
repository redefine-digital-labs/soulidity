import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider } from '@mysten/dapp-kit'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { PrivyProvider as BasePrivyProvider, useCustomAuth, usePrivy } from '@privy-io/react-auth'
import type {
  ExtractSoulDraft,
  ExtractSoulDraftPendingSync,
  SessionScanResult,
  ScanProgress,
  SoulProfile,
} from '@soulidity/shared'
import {
  createExtractSoulDraft,
  regenerateExtractSoulDraftContent,
} from '@soulidity/shared'
import { assertObjectInputsExist } from '../../lib/soulidity/object-inputs'
import { buildPublishSoulTx } from '../../lib/soulidity/tx/publish'
import { usePrivySuiSign } from '../../lib/hooks/use-privy-sui'

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
  privyAppId: string | null
  suiNetwork: string
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
    return await invoke()
  } catch (err) {
    throw asIpcError(err, 'Scan failed')
  }
}

async function ipcAnalyzeProfile(results: SessionScanResult[]): Promise<SoulProfile> {
  const invoke = getElectronMethod<(results: SessionScanResult[]) => Promise<SoulProfile>>(
    'extraction:analyze-profile',
    'Analyze IPC not available — is the companion up to date?',
  )

  try {
    return await invoke(results)
  } catch (err) {
    throw asIpcError(err, 'Profile analysis failed')
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
    return await invoke()
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

async function ipcGetRuntimeConfig(): Promise<RuntimeConfig | null> {
  const invoke = getOptionalElectronMethod<() => Promise<RuntimeConfig>>('getDesktopRuntimeConfig')
  if (!invoke) return null

  try {
    return await invoke()
  } catch {
    return null
  }
}

async function ipcGetPrivyToken(): Promise<{ jwt: string; alreadyLinked: boolean }> {
  const invoke = getElectronMethod<() => Promise<{ jwt: string; alreadyLinked: boolean }>>(
    'getDesktopPrivyToken',
    'Desktop Privy auth IPC is not available',
  )

  try {
    return await invoke()
  } catch (err) {
    throw asIpcError(err, 'Failed to fetch desktop wallet auth token')
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

function openSettingsTab() {
  window.dispatchEvent(new CustomEvent('desktop:navigate-tab', { detail: { tab: 'settings' } }))
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

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
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
  const { ready, authenticated } = usePrivy()
  const { status: customAuthStatus } = useCustomAuth()
  const { suiWallet, signAndExecute, suiClient } = usePrivySuiSign()
  const [mintStatus, setMintStatus] = useState<MintStatus>('idle')
  const [mintError, setMintError] = useState<string | null>(null)
  const [publishResult, setPublishResult] = useState<DesktopPublishResponse | null>(null)

  const walletMismatch = useMemo(
    () => Boolean(primarySuiAddress && suiWallet?.address && !sameWalletAddress(primarySuiAddress, suiWallet.address)),
    [primarySuiAddress, suiWallet?.address],
  )

  const handleMint = useCallback(async () => {
    if (!ready) {
      setMintStatus('error')
      setMintError('Desktop wallet auth is still loading. Try again in a moment.')
      return
    }

    if (!authenticated) {
      setMintStatus('error')
      setMintError('Desktop wallet auth is not ready yet. Re-link this desktop if the problem persists.')
      return
    }

    if (!primarySuiAddress) {
      setMintStatus('error')
      setMintError('Bind a primary Sui wallet before minting from desktop.')
      return
    }

    if (!suiWallet?.address) {
      setMintStatus('error')
      setMintError('No Sui wallet is available for this desktop session.')
      return
    }

    if (walletMismatch) {
      setMintStatus('error')
      setMintError('The connected desktop wallet does not match the bound Sui wallet for this account.')
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
        metadataRef: null,
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
  }, [authenticated, draft, onMintSuccess, primarySuiAddress, ready, signAndExecute, suiClient, suiWallet?.address, walletMismatch])

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
            {customAuthStatus.status === 'error'
              ? customAuthStatus.error?.message || 'error'
              : customAuthStatus.status}
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
        disabled={mintStatus !== 'idle' && mintStatus !== 'error' && mintStatus !== 'done'}
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
  const getCustomAccessToken = useCallback(async () => {
    const token = await ipcGetPrivyToken()
    return token.jwt
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={suiNetworks} defaultNetwork={defaultNetwork}>
        <BasePrivyProvider
          appId={runtimeConfig.privyAppId!}
          config={{
            customAuth: {
              enabled: true,
              getCustomAccessToken,
              isLoading: false,
            },
            appearance: {
              showWalletLoginFirst: false,
            },
          }}
        >
          <DesktopMintPanelInner {...props} />
        </BasePrivyProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  )
}

function DesktopMintPanel(props: DesktopMintPanelProps) {
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null)

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

  if (!runtimeConfig.privyAppId) {
    return (
      <section className="settings-section">
        <p className="link-panel__error">
          Desktop minting is not configured because `NEXT_PUBLIC_PRIVY_APP_ID` is missing.
        </p>
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
  const [profile, setProfile] = useState<SoulProfile | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [desktopAuth, setDesktopAuth] = useState<DesktopAuthStatus>({ hasToken: true, accountId: null })
  const [desktopMe, setDesktopMe] = useState<DesktopMeResponse | null>(null)
  const [draft, setDraft] = useState<ExtractSoulDraft | null>(null)
  const [authGateError, setAuthGateError] = useState<string | null>(null)
  const [publishResult, setPublishResult] = useState<DesktopPublishResponse | null>(null)

  const unsubRef = useRef<(() => void) | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasHydratedDraftRef = useRef(false)

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

      setDesktopAuth(authStatus)
      if (loadedDraft) {
        setDraft(loadedDraft)
        setProfile(loadedDraft.sourceProfile)
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

  const handleStartScan = useCallback(async () => {
    if (!desktopAuth.hasToken) {
      setAuthGateError('Link this desktop in Settings before scanning')
      return
    }

    setAuthGateError(null)
    setIsScanning(true)
    setScanError(null)
    setScanProgress([])
    setScanResults(null)

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
      setIsAnalyzing(true)
      try {
        const nextProfile = await ipcAnalyzeProfile(results)
        setProfile(nextProfile)
        setDraft(createExtractSoulDraft(nextProfile))
      } catch (err) {
        setAnalyzeError(err instanceof Error ? err.message : 'Profile analysis failed')
      } finally {
        setIsAnalyzing(false)
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setIsScanning(false)
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [desktopAuth.hasToken])

  const handleReanalyze = useCallback(async () => {
    if (!scanResults) return
    setIsAnalyzing(true)
    setAnalyzeError(null)
    try {
      const nextProfile = await ipcAnalyzeProfile(scanResults)
      setProfile(nextProfile)
      setDraft(createExtractSoulDraft(nextProfile))
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'Re-analysis failed')
    } finally {
      setIsAnalyzing(false)
    }
  }, [scanResults])

  const handleCreateLocally = useCallback(() => {
    if (!draft && profile) {
      setDraft(createExtractSoulDraft(profile))
    }
    setStep('create')
  }, [draft, profile])

  const handleCoverFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const dataUrl = await fileToDataUrl(file)
    updateDraft((current) => ({
      ...current,
      coverImageDataUrl: dataUrl,
      coverImageFileName: file.name,
      coverImageMimeType: file.type || 'application/octet-stream',
      coverImageGenerated: false,
      updatedAt: new Date().toISOString(),
    }))
  }, [updateDraft])

  const handleSkillsFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

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
            Only statistical patterns are extracted. No code or conversations leave your machine.
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

          {authGateError && (
            <div style={{ marginTop: 12 }}>
              <p className="link-panel__error">{authGateError}</p>
              <button type="button" className="link-button link-button--secondary" onClick={openSettingsTab}>
                Open Settings
              </button>
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
    return (
      <div className="tab-content">
        {isAnalyzing && (
          <section className="settings-section">
            <h3 className="settings-section__title">Analyzing Profile</h3>
            <p className="extract-status">Running personality extraction...</p>
          </section>
        )}

        {analyzeError && (
          <section className="settings-section">
            <p className="link-panel__error">{analyzeError}</p>
            <button type="button" className="link-button" onClick={handleReanalyze}>
              Retry Analysis
            </button>
          </section>
        )}

        {profile && !isAnalyzing && (
          <>
            <section className="settings-section">
              <h3 className="settings-section__title">Extracted Signal</h3>
              <div className="extract-summary__row">
                <span className="extract-summary__label">Suggested Name</span>
                <span className="extract-summary__value">{profile.suggested.name}</span>
              </div>
              <div className="extract-summary__row">
                <span className="extract-summary__label">Description</span>
                <span className="extract-summary__value">{profile.suggested.description}</span>
              </div>
              <div className="extract-summary__row">
                <span className="extract-summary__label">Traits</span>
                <span className="extract-summary__value">{profile.personality.traits.join(', ') || '—'}</span>
              </div>
              <div className="extract-summary__row">
                <span className="extract-summary__label">Communication</span>
                <span className="extract-summary__value">{profile.personality.communicationStyle || '—'}</span>
              </div>
              <div className="extract-summary__row">
                <span className="extract-summary__label">Expertise</span>
                <span className="extract-summary__value">{profile.personality.expertise.join(', ') || '—'}</span>
              </div>
              <div className="extract-summary__row">
                <span className="extract-summary__label">Work Style</span>
                <span className="extract-summary__value">{profile.personality.workStyle || '—'}</span>
              </div>
            </section>

            <section className="settings-section">
              <h3 className="settings-section__title">Evidence</h3>
              <div className="extract-evidence">
                <div className="extract-evidence__row">
                  <span className="extract-evidence__label">Sessions</span>
                  <span className="extract-evidence__value">{profile.evidence.sessionCount}</span>
                </div>
                <div className="extract-evidence__row">
                  <span className="extract-evidence__label">Turns</span>
                  <span className="extract-evidence__value">{profile.evidence.turnCount}</span>
                </div>
                <div className="extract-evidence__row">
                  <span className="extract-evidence__label">Top Tools</span>
                  <span className="extract-evidence__value">{profile.evidence.topTools.join(', ') || '—'}</span>
                </div>
                <div className="extract-evidence__row">
                  <span className="extract-evidence__label">Languages</span>
                  <span className="extract-evidence__value">{profile.evidence.primaryLanguages.join(', ') || '—'}</span>
                </div>
                <div className="extract-evidence__row">
                  <span className="extract-evidence__label">Peak Hours</span>
                  <span className="extract-evidence__value">{formatHours(profile.evidence.peakHours)}</span>
                </div>
              </div>
            </section>

            <section className="settings-section" style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="link-button link-button--secondary" onClick={handleReanalyze} style={{ flex: 1 }}>
                Re-analyze
              </button>
              <button type="button" className="link-button" onClick={handleCreateLocally} style={{ flex: 1 }}>
                Create Locally
              </button>
            </section>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="tab-content">
      <section className="settings-section">
        <h3 className="settings-section__title">Create Soul Locally</h3>
        <p className="extract-notice">
          The extracted structure seeds a full local draft. Markdown content is editable and only regenerates when you ask for it.
        </p>
      </section>

      {draft && (
        <>
          <section className="settings-section">
            <h3 className="settings-section__title">Basic Info</h3>
            <div className="settings-field">
              <span className="settings-field__label">Name</span>
              <input
                type="text"
                className="settings-field__input"
                value={draft.name}
                onChange={(event) => updateDraft((current) => ({
                  ...current,
                  name: event.target.value,
                  updatedAt: new Date().toISOString(),
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
                  ...current,
                  tags: parseListInput(event.target.value),
                  updatedAt: new Date().toISOString(),
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
              <label className="link-button link-button--secondary" style={{ display: 'inline-flex', width: 'fit-content', cursor: 'pointer' }}>
                Replace Cover
                <input type="file" accept="image/*,.svg" style={{ display: 'none' }} onChange={handleCoverFileChange} />
              </label>
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
            <button
              type="button"
              className="link-button"
              onClick={() => updateDraft((current) => regenerateExtractSoulDraftContent({
                ...current,
                updatedAt: new Date().toISOString(),
              }))}
              style={{ flex: 1 }}
            >
              Regenerate from Extract
            </button>
          </section>

          <DesktopMintPanel
            draft={draft}
            primarySuiAddress={desktopMe?.profile.primarySuiAddress ?? null}
            onMintSuccess={(result) => {
              setPublishResult(result)
              setDraft(null)
            }}
          />

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
        </>
      )}
    </div>
  )
}
