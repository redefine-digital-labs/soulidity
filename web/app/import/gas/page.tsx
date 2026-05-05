'use client'

import { useEffect, useRef, useState } from 'react'
import { useAutoConnectWallet, useCurrentWallet, useSuiClient } from '@mysten/dapp-kit'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'
import { TxRow } from '@/components/shared/tx-row'
import {
  formatBalance,
  minimumSuiBalanceForWalletTransactions,
  useWalletBalances,
} from '@/lib/hooks/use-wallet-balances'
import { useImport } from '@/lib/hooks/use-import'
import { useAuth } from '@/components/providers/auth-provider'
import {
  prepareSoulBlobsForBatchPublish,
  WalrusUploadCancelledError,
  type BatchSoulUploadFile,
  type PreparedSoulBlobs,
} from '@/lib/upload/client-upload'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useLogin } from '@/lib/hooks/use-login'
import { getWalletActionState } from '@/lib/wallet/wallet-action-state'
import { useUploadCostReview } from '@/components/upload/upload-cost-review'
import { captureFrontendException } from '@/lib/observability/posthog-client-errors'
import { hasCurrentSoulidityDeploymentSignature } from '@soulidity/sdk'
import {
  useImportSoul,
  type UploadResults,
} from '@/components/providers/import-soul-provider'

const steps = [
  { label: 'Choose Source' },
  { label: 'Upload File' },
  { label: 'Map Fields' },
  { label: 'Preview & Confirm' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

const royaltyLabels: Record<number, string> = {
  0: 'Off \u00b7 0% (locked on-chain)',
  250: 'Low \u00b7 2.5% (locked on-chain)',
  500: 'Standard \u00b7 5% (locked on-chain)',
  1000: 'High \u00b7 10% (locked on-chain)',
}

type UploadPhase =
  | 'idle'
  | 'preparing-uploads'
  | 'awaiting-register-signature'
  | 'uploading-to-relay'
  | 'done'

const uploadPhaseLabels: Record<UploadPhase, string> = {
  idle: '',
  'preparing-uploads': 'Encrypting & encoding files\u2026',
  'awaiting-register-signature': 'Awaiting wallet signature for batched register\u2026',
  'uploading-to-relay': 'Uploading encoded payloads to Walrus\u2026',
  done: 'Uploads complete',
}

const MIME_MAP: Record<string, string> = {
  '.md': 'text/markdown', '.txt': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
  '.json': 'application/json', '.zip': 'application/zip',
}

function withMime(file: File): File {
  const ext = file.name.includes('.') ? '.' + file.name.split('.').pop()!.toLowerCase() : ''
  const expected = MIME_MAP[ext]
  if (!expected || file.type === expected) return file
  return new File([file], file.name, { type: expected })
}

function truncateHash(hash: string, len = 16) {
  if (hash.length <= len) return hash
  return `${hash.slice(0, 10)}…${hash.slice(-4)}`
}

function buildBatchFingerprint(walletAddress: string, files: BatchSoulUploadFile[]): string {
  return JSON.stringify({
    walletAddress: walletAddress.toLowerCase(),
    files: files.map((f) => ({
      name: f.file.name,
      size: f.file.size,
      lastModified: f.file.lastModified,
      type: f.file.type,
      uploadType: f.uploadType,
      kind: f.kind,
      sendObjectTo: f.sendObjectTo?.trim().toLowerCase() ?? null,
    })),
  })
}

function checkImportRecovery(userId: string | undefined): boolean {
  if (typeof window === 'undefined' || !userId) return false
  try {
    const raw = sessionStorage.getItem('soul-import-recovery')
    if (raw) {
      const recovery = JSON.parse(raw)
      return !!recovery.txDigest && recovery.userId === userId && hasCurrentSoulidityDeploymentSignature(recovery)
    }
  } catch {}
  return false
}

export default function ImportGasPage() {
  const router = useRouter()
  const suiClient = useSuiClient()
  const ctx = useImportSoul()
  const { setImportResult } = ctx
  const { status, error, txDigest, importData, importSoul, suiWallet } = useImport()
  const { signAndExecute } = useWalletSign()
  const walletConnection = useCurrentWallet()
  const autoConnectStatus = useAutoConnectWallet()
  const openWalletLogin = useLogin()
  const { requestUploadCostApproval } = useUploadCostReview()
  const { user, getAuthHeaders } = useAuth()

  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle')
  const [deployError, setDeployError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const completedDigestRef = useRef<string | null>(null)
  const preparedBatchRef = useRef<{
    walletAddress: string
    fingerprint: string
    prepared: PreparedSoulBlobs
  } | null>(null)

  const balances = useWalletBalances(suiWallet?.address ?? null)
  // Batched import uses one Walrus register PTB and one import+certify PTB.
  const importWalletTransactionCount = 2
  const minImportSuiBalance = minimumSuiBalanceForWalletTransactions(importWalletTransactionCount)
  const suiInsufficient = balances.sui !== null && balances.sui < minImportSuiBalance
  const balanceBlocked = suiInsufficient

  const missing = !ctx.resolvedName || !ctx.resolvedDescription || !ctx.coverImageFile || !ctx.charFile || !ctx.memoryFile
  const [hasImportRecovery, setHasImportRecovery] = useState(false)
  // Detect recovery from both sessionStorage (remount) and in-memory state (same-tab sync failure)
  const inRecovery = (hasImportRecovery || (!!txDigest && status === 'error')) && status !== 'done'

  // Re-evaluate recovery state reactively when auth resolves
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      setHasImportRecovery(checkImportRecovery(user?.id))
    })
    return () => { cancelled = true }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return // Wait for auth before redirecting
    if (status === 'done' || checkImportRecovery(user?.id)) return
    if (missing) router.replace('/import/map')
  }, [missing, status, router, user?.id])

  useEffect(() => {
    if (status === 'done' && importData) {
      if (completedDigestRef.current === importData.txDigest) return
      completedDigestRef.current = importData.txDigest
      setImportResult(importData)
      router.replace('/import/success')
    }
  }, [status, importData, setImportResult, router])

  async function handleDeploy() {
    if (!ctx.coverImageFile || !ctx.charFile || !ctx.memoryFile || !suiWallet) return

    setDeployError(null)
    ctx.setImportResult(null)
    const walletAddress = suiWallet.address

    try {
      const authHeaders = await getAuthHeaders()
      const fileIndex = { cover: -1, char: -1, memory: -1, skills: -1 }
      const batchFiles: BatchSoulUploadFile[] = []

      fileIndex.cover = batchFiles.length
      batchFiles.push({
        file: withMime(ctx.coverImageFile),
        uploadType: 'public',
        kind: 'soul-content',
      })

      fileIndex.char = batchFiles.length
      batchFiles.push({
        file: withMime(ctx.charFile),
        uploadType: 'encrypted',
        kind: 'soul-content',
        sendObjectTo: walletAddress,
      })

      fileIndex.memory = batchFiles.length
      batchFiles.push({
        file: withMime(ctx.memoryFile),
        uploadType: 'encrypted',
        kind: 'soul-content',
        sendObjectTo: walletAddress,
      })

      if (ctx.skillsFile) {
        fileIndex.skills = batchFiles.length
        batchFiles.push({
          file: withMime(ctx.skillsFile),
          uploadType: 'encrypted',
          kind: 'soul-content',
          sendObjectTo: walletAddress,
        })
      }

      const fingerprint = buildBatchFingerprint(walletAddress, batchFiles)
      const cachedBatch = preparedBatchRef.current
      const reusable =
        !!cachedBatch
        && cachedBatch.walletAddress === walletAddress
        && cachedBatch.fingerprint === fingerprint
      let prepared: PreparedSoulBlobs
      if (reusable) {
        prepared = cachedBatch.prepared
      } else {
        if (cachedBatch) preparedBatchRef.current = null
        setUploadPhase('preparing-uploads')
        prepared = await prepareSoulBlobsForBatchPublish({
          files: batchFiles,
          walletAddress,
          suiClient,
          signAndExecute,
          authHeaders,
          confirmQuote: async (quote) => {
            setUploadPhase('awaiting-register-signature')
            const approved = await requestUploadCostApproval(quote)
            if (approved) setUploadPhase('uploading-to-relay')
            return approved
          },
        })
        preparedBatchRef.current = { walletAddress, fingerprint, prepared }
      }

      const cover = prepared.files[fileIndex.cover]
      const char = prepared.files[fileIndex.char]
      const memory = prepared.files[fileIndex.memory]
      const skills = fileIndex.skills >= 0 ? prepared.files[fileIndex.skills] : null

      if (!char.sealMaterial) {
        throw new Error('Character file upload is missing Seal recovery data. Please retry.')
      }
      if (!memory.sealMaterial) {
        throw new Error('Memory file upload is missing Seal recovery data. Please retry.')
      }
      if (skills && !skills.sealMaterial) {
        throw new Error('Skills bundle upload is missing Seal recovery data. Please retry.')
      }
      if (!char.blobObjectId) {
        throw new Error('Character file upload was deduplicated by Walrus. Please modify your character file slightly and retry.')
      }
      if (!memory.blobObjectId) {
        throw new Error('Memory already exists on Walrus. Please modify your memory file slightly and retry.')
      }
      if (skills && !skills.blobObjectId) {
        throw new Error('Skills bundle was deduplicated by Walrus. Please modify your skills file slightly and retry.')
      }

      const results: UploadResults = {
        ownerAddress: walletAddress,
        coverImage: {
          blobId: cover.blobId,
          blobObjectId: cover.blobObjectId,
          contentHash: cover.contentHash,
          blobUrl: cover.blobUrl,
        },
        charFile: {
          blobId: char.blobId,
          blobObjectId: char.blobObjectId,
          contentHash: char.contentHash,
          blobUrl: char.blobUrl,
          sealMaterial: char.sealMaterial,
          skillName: char.skillName ?? null,
        },
        memorySeed: {
          blobId: memory.blobId,
          blobObjectId: memory.blobObjectId,
          contentHash: memory.contentHash,
          blobUrl: memory.blobUrl,
          sealMaterial: memory.sealMaterial,
        },
        skillsFile: skills && skills.sealMaterial
          ? {
              blobId: skills.blobId,
              blobObjectId: skills.blobObjectId,
              contentHash: skills.contentHash,
              blobUrl: skills.blobUrl,
              sealMaterial: skills.sealMaterial,
              skillName: skills.skillName ?? null,
            }
          : undefined,
      }
      ctx.setUploadResults(results)
      setUploadPhase('done')

      if (process.env.NODE_ENV === 'development') {
        ;(window as any).__e2eLastSealMaterial = {
          char: char.sealMaterial,
          memory: memory.sealMaterial,
          skills: skills?.sealMaterial ?? null,
        }
      }

      const parsedTags = ctx.tags.split(',').map((t) => t.trim()).filter(Boolean)

      await importSoul({
        name: ctx.resolvedName,
        description: ctx.resolvedDescription,
        tags: parsedTags,
        imageUrl: cover.blobUrl,
        previewImages: [cover.blobUrl],
        protectedBlobObjectId: char.blobObjectId,
        foundingMemoryBlobObjectId: memory.blobObjectId,
        skillsBlobObjectId: skills?.blobObjectId ?? null,
        initialSkillName: skills?.skillName ?? null,
        skillsVisibility: 'private',
        originRef: ctx.originRef,
        creatorRoyaltyBps: ctx.royalty,
        sealMaterial: char.sealMaterial ?? null,
        memorySealMaterial: memory.sealMaterial ?? null,
        skillsSealMaterial: skills?.sealMaterial ?? null,
        attachWalrusCertifyCalls: prepared.attachCertifyCalls,
        onImportTxExecuted: () => {
          prepared.clearBatchRecovery()
          preparedBatchRef.current = null
        },
      })
    } catch (err) {
      if (!(err instanceof WalrusUploadCancelledError)) {
        captureFrontendException(err, {
          scope: 'import_soul_deploy',
          phase: uploadPhase,
        })
      }
      setDeployError(err instanceof Error ? err.message : 'Deploy failed')
      setUploadPhase('idle')
    }
  }

  async function handleResume() {
    if (!suiWallet || !txDigest) return
    setDeployError(null)
    try {
      await importSoul({
        name: '', description: '', tags: [], imageUrl: '',
        previewImages: [], protectedBlobObjectId: '', foundingMemoryBlobObjectId: '',
        creatorRoyaltyBps: 0,
        originRef: ctx.originRef,
      })
    } catch (err) {
      captureFrontendException(err, {
        scope: 'import_soul_resume_sync',
        txDigest,
      })
      setDeployError(err instanceof Error ? err.message : 'Resume failed')
    }
  }

  function handleAbandonRecovery() {
    ctx.reset()
    router.replace('/import')
  }

  if (!inRecovery && status !== 'done' && missing) return null

  const network = process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet'
  const networkLabel = network === 'mainnet' ? 'Sui Mainnet' : `Sui ${network.charAt(0).toUpperCase() + network.slice(1)}`
  const isBusy = (uploadPhase !== 'idle' && uploadPhase !== 'done') || status === 'building' || status === 'signing' || status === 'syncing'
  const combinedError = deployError || error
  const walletRestoring = !suiWallet && (walletConnection.isConnecting || autoConnectStatus === 'idle')
  const walletActionState = getWalletActionState({
    hasActiveWallet: !!suiWallet,
    hasSessionWallet: !!user?.primarySuiAddress,
    walletRestoring,
    busy: isBusy,
    busyLabel: uploadPhaseLabels[uploadPhase] || `${status}...`,
    balanceBlocked,
    recovery: inRecovery,
    txDigest,
    readyLabel: '✓ Sign & Deploy',
  })

  function handleWalletAction(action: () => void | Promise<void>) {
    if (walletActionState.needsWalletReconnect) {
      openWalletLogin()
      return
    }
    void action()
  }

  return (
    <div className="relative z-10 border-t border-purple/20">
      <FlowBar steps={steps} currentStep={4} />

      <PageContainer size="sm" className="space-y-5 pt-7 sm:pt-9">
        <SectionHeader
          label="Import Soul"
          title={inRecovery ? 'Step 5 — Resume Sync' : 'Step 5 — Pay Gas'}
          subtitle={inRecovery
            ? 'Your previous import transaction succeeded. Complete the sync to finish importing your Soul.'
            : 'Your imported Soul will be minted on Sui. Review the transaction before signing.'}
          className="mb-1"
        />

        {inRecovery ? (
          <div className="space-y-3 rounded-2xl border border-[#F59E0B]/40 bg-[#F59E0B]/8 p-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#F59E0B]">
              Pending Soul Import
            </div>
            <p className="text-sm leading-relaxed text-muted">
              A previous import transaction succeeded on-chain but the mirror sync was interrupted.
              Resume to complete the process, or start over.
            </p>
            {txDigest && (
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-black/20 px-3 py-2">
                <span className="text-[10px] text-muted">TX Digest</span>
                <span className="font-mono text-xs text-teal">{txDigest.slice(0, 16)}…</span>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-purple/30 bg-card p-5">
              <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.08em] text-[#F59E0B]">
                Transaction Preview
              </div>
              <div className="divide-y divide-border/50">
                <TxRow label="Contract">
                  <span className="font-mono text-teal">market::mint_imported_in_personal_kiosk</span>
                </TxRow>
                <TxRow label="Network">
                  <span className="font-semibold text-foreground">{networkLabel}</span>
                </TxRow>
                <TxRow label="Soul Name">
                  <span className="font-semibold text-foreground">{ctx.resolvedName}</span>
                </TxRow>
                <TxRow label="Origin Ref">
                  <span className="font-mono text-xs text-teal">{truncateHash(ctx.originRef)}</span>
                </TxRow>
                <TxRow label="Provenance">
                  <span className="rounded-full border border-purple/30 bg-purple/15 px-2 py-0.5 text-[10px] font-bold text-purple">
                    imported
                  </span>
                </TxRow>
                <TxRow label="Soul Character">
                  <span className="text-foreground">{ctx.charFile?.name}</span>
                  <span className="ml-1.5 text-muted">(encrypted via Seal)</span>
                </TxRow>
                <TxRow label="Memory">
                  <span className="text-foreground">{ctx.memoryFile?.name}</span>
                  <span className="ml-1.5 text-muted">(encrypted founding entry)</span>
                </TxRow>
                {ctx.skillsFile && (
                  <TxRow label="Skills & Docs">
                    <span className="text-foreground">{ctx.skillsFile.name}</span>
                    <span className="ml-1.5 text-muted">(Seal encrypted)</span>
                  </TxRow>
                )}
                <TxRow label="Creator Royalty">
                  <span className="font-semibold text-[#F59E0B]">
                    {royaltyLabels[ctx.royalty] ?? `${ctx.royalty / 100}% (locked on-chain)`}
                  </span>
                </TxRow>
                <TxRow label="Soul Policy" align="top">
                  <span className="text-muted leading-relaxed">
                    Character locked after mint · Grant-gated memory writes · Skills private by default · Revocable
                  </span>
                </TxRow>
                <TxRow label="Estimated Gas">
                  <span className="text-foreground">~0.005 SUI</span>
                </TxRow>
                <TxRow label="Walrus Storage">
                  <span className="text-muted">Paid by connected wallet after cost review</span>
                </TxRow>
              </div>
            </div>

            {/* Balance warning */}
            {!balances.loading && balanceBlocked && (
              <div className="space-y-2 rounded-2xl border border-danger/40 bg-danger/8 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-danger">
                  Insufficient Balance
                </div>
                {suiInsufficient && (
                  <p className="text-xs text-danger/90">
                    SUI balance: <span className="font-mono font-semibold">{formatBalance(balances.sui!, 9)} SUI</span>
                    {' '}— need at least <span className="font-semibold">{formatBalance(minImportSuiBalance, 9)} SUI</span> for gas fees.
                  </p>
                )}
                {suiWallet && (
                  <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-black/20 px-3 py-2">
                    <span className="shrink-0 text-[10px] text-muted">Your address:</span>
                    <code className="min-w-0 text-[11px] font-mono text-foreground">
                      {suiWallet.address.slice(0, 20)}…{suiWallet.address.slice(-20)}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(suiWallet.address)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }}
                      className={`shrink-0 rounded p-1 transition-colors ${copied ? 'text-success' : 'text-muted/60 hover:text-foreground'}`}
                      aria-label="Copy address"
                    >
                      {copied ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="m3.5 8.25 2.5 2.5L12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <rect x="5.5" y="5.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <p className="text-[11px] text-muted">Top up with SUI before deploying.</p>
                  <button
                    type="button"
                    disabled={balances.loading}
                    onClick={() => balances.refresh()}
                    className={`shrink-0 rounded p-1 text-muted/60 transition-colors hover:text-foreground ${balances.loading ? 'animate-spin' : ''}`}
                    aria-label="Refresh balance"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M2.5 8a5.5 5.5 0 0 1 9.95-3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M10 2l2.75 2.75L10 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M13.5 8a5.5 5.5 0 0 1-9.95 3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Status */}
        {(status !== 'idle' || combinedError) && (
          <div className="card space-y-3 px-5 py-4" data-testid="import-status">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Status</span>
              <span className={`text-sm font-semibold ${
                status === 'done' ? 'text-success'
                  : status === 'error' || combinedError ? 'text-danger'
                    : 'text-purple'
              }`}>
                {uploadPhase !== 'idle' && uploadPhase !== 'done' && uploadPhaseLabels[uploadPhase]}
                {uploadPhase === 'done' && status === 'building' && '⟳ Building TX…'}
                {status === 'signing' && '⟳ Signing…'}
                {status === 'syncing' && '⟳ Syncing…'}
                {status === 'done' && '✓ Imported'}
                {status === 'error' && '✗ Failed'}
              </span>
            </div>
            {txDigest && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">TX Digest</span>
                <span className="text-sm font-mono text-foreground">{txDigest.slice(0, 16)}…</span>
              </div>
            )}
            {combinedError && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                {combinedError}
              </div>
            )}
          </div>
        )}

        {/* Deploying overlay */}
        {isBusy && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="mx-4 max-w-sm rounded-2xl border border-purple/30 bg-card2 p-10 text-center shadow-[0_24px_60px_rgba(124,58,237,0.25)]">
              <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-purple/30 border-t-purple" />
              <h2 className="mb-2 text-lg font-bold">
                {uploadPhase !== 'idle' && uploadPhase !== 'done'
                  ? 'Uploading to Walrus…'
                  : 'Importing Soul…'}
              </h2>
              <p className="text-sm text-muted">
                {uploadPhase !== 'idle' && uploadPhase !== 'done'
                  ? uploadPhaseLabels[uploadPhase]
                  : `Writing to ${networkLabel} · Registering Seal policy`}
              </p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
          {inRecovery ? (
            <button
              type="button"
              onClick={handleAbandonRecovery}
              className={buttonStyles({
                variant: 'outline',
                size: 'lg',
                className: 'w-full rounded-[10px] border-purple/20 bg-transparent px-4 py-2.5 text-[13px] text-foreground hover:border-purple/45 hover:text-foreground sm:w-auto sm:min-w-[76px]',
              })}
            >
              Start Over
            </button>
          ) : (
            <Link
              href="/import/preview"
              className={buttonStyles({
                variant: 'outline',
                size: 'lg',
                className: 'w-full rounded-[10px] border-purple/20 bg-transparent px-4 py-2.5 text-[13px] text-foreground hover:border-purple/45 hover:text-foreground sm:w-auto sm:min-w-[76px]',
              })}
            >
              ← Back
            </Link>
          )}
          {status === 'done' ? (
            <Link
              href="/import/success"
              className={buttonStyles({ variant: 'gold', size: 'lg', full: true, className: 'rounded-[10px] px-4 py-2.5 text-[13px]' })}
            >
              Continue <span aria-hidden="true">→</span>
            </Link>
          ) : inRecovery ? (
            <button
              type="button"
              disabled={walletActionState.disabled}
              onClick={() => handleWalletAction(handleResume)}
              className={buttonStyles({
                variant: 'gold',
                size: 'lg',
                full: true,
                className: `rounded-[10px] px-4 py-2.5 text-[13px] ${isBusy ? 'opacity-60 cursor-wait' : ''} ${walletActionState.disabled ? 'opacity-50 cursor-not-allowed' : ''}`,
              })}
            >
              {walletActionState.label}
            </button>
          ) : (
            <button
              type="button"
              disabled={walletActionState.disabled}
              onClick={() => handleWalletAction(handleDeploy)}
              className={buttonStyles({
                variant: 'gold',
                size: 'lg',
                full: true,
                className: `rounded-[10px] px-4 py-2.5 text-[13px] ${isBusy ? 'opacity-60 cursor-wait' : ''} ${walletActionState.disabled ? 'opacity-50 cursor-not-allowed' : ''}`,
              })}
            >
              {walletActionState.label}
            </button>
          )}
        </div>
      </PageContainer>
    </div>
  )
}
