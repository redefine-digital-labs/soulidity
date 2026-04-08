'use client'

import { useEffect, useRef, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { usePublish, type PublishParams } from '@/lib/hooks/use-publish'
import { useAuth } from '@/components/providers/auth-provider'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'
import { buildListSoulTx } from '@/lib/soulidity/tx/list'
import { buildIssueGrantTx, buildRevokeGrantTx } from '@/lib/soulidity/tx/grant'
import { hasCurrentSoulidityDeploymentSignature } from '@/lib/soulidity/client-session'
import { findMissingObjectIds } from '@/lib/soulidity/object-inputs'
import {
  selectReusableUploadResults,
  useCreateSoul,
  type UploadResults,
} from '@/components/providers/create-soul-provider'
import { TxRow } from '@/components/shared/tx-row'
import {
  MIN_SUI_BALANCE,
  formatBalance,
  useWalletBalances,
} from '@/lib/hooks/use-wallet-balances'

const steps = [
  { label: 'Basic Info' },
  { label: 'Living Content' },
  { label: 'Soul Awakened' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

const royaltyLabels: Record<number, string> = {
  0: 'Off · 0% (locked on-chain)',
  250: 'Low · 2.5% (locked on-chain)',
  500: 'Standard · 5% (locked on-chain)',
  1000: 'High · 10% (locked on-chain)',
}

type UploadPhase =
  | 'idle'
  | 'uploading-cover'
  | 'uploading-character'
  | 'uploading-memory'
  | 'uploading-skills'
  | 'done'

const uploadPhaseLabels: Record<UploadPhase, string> = {
  'idle': '',
  'uploading-cover': 'Uploading cover image…',
  'uploading-character': 'Encrypting & uploading character file…',
  'uploading-memory': 'Encrypting & uploading memory…',
  'uploading-skills': 'Encrypting & uploading skills bundle…',
  'done': 'Uploads complete',
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

async function uploadFile(
  file: File,
  type: 'public' | 'encrypted',
  headers: Record<string, string>,
  sendObjectTo?: string,
) {
  const formData = new FormData()
  formData.append('file', withMime(file))
  formData.append('type', type)
  if (sendObjectTo) formData.append('sendObjectTo', sendObjectTo)
  const res = await fetch('/api/souls/upload', { method: 'POST', headers, body: formData })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Upload failed: ${res.status}`)
  }
  return res.json()
}


function checkMintRecovery(userId: string | undefined): boolean {
  if (typeof window === 'undefined' || !userId) return false
  try {
    const raw = sessionStorage.getItem('soul-mint-recovery')
    if (raw) {
      const recovery = JSON.parse(raw)
      return !!recovery.txDigest && recovery.userId === userId && hasCurrentSoulidityDeploymentSignature(recovery)
    }
  } catch {}
  return false
}

export default function CreateGasPage() {
  const router = useRouter()
  const suiClient = useSuiClient()
  const ctx = useCreateSoul()
  const { status, error, txDigest, publishData, publish, suiWallet } = usePublish()
  const { getAuthHeaders, user } = useAuth()
  const { showToast } = useToast()
  const { signAndExecute } = usePrivySuiSign()
  const publishRef = useRef(publish)
  const getAuthHeadersRef = useRef(getAuthHeaders)
  const signAndExecuteRef = useRef(signAndExecute)
  publishRef.current = publish
  getAuthHeadersRef.current = getAuthHeaders
  signAndExecuteRef.current = signAndExecute

  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle')
  const [deployError, setDeployError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // ── Balance checking ──
  const balances = useWalletBalances(suiWallet?.address ?? null)
  const suiInsufficient = balances.sui !== null && balances.sui < MIN_SUI_BALANCE
  const balanceBlocked = suiInsufficient

  // Guard: redirect to earliest incomplete step when required data is missing
  const missingStep1 = !ctx.name || !ctx.description || !ctx.coverImageFile
  const missingStep2 = !ctx.charFile || !ctx.memoryFile

  // Detect pending mint recovery: on-chain TX succeeded but sync was interrupted.
  // useState initializer reads sessionStorage synchronously to avoid race with redirect effect.
  const [hasMintRecovery] = useState(() => checkMintRecovery(user?.id))
  const inRecovery = hasMintRecovery && status !== 'done'

  useEffect(() => {
    if (status === 'done' || checkMintRecovery(user?.id)) return
    if (missingStep1) {
      router.replace('/create')
    } else if (missingStep2) {
      router.replace('/create/content')
    }
  }, [missingStep1, missingStep2, status, router, user?.id])

  // Store publish result in context when done
  useEffect(() => {
    if (status === 'done' && publishData) {
      ctx.setPublishResult(publishData)
      showToast('Soul minted successfully!', 'success')
      router.replace('/create/success')
    }
  }, [status, publishData, ctx, router, showToast])

  // Toast on mint error
  useEffect(() => {
    if (status === 'error' && error) {
      showToast(`Mint failed: ${error}`, 'danger')
    }
  }, [status, error, showToast])

  // Expose publish + authenticated upload + list for E2E testing
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    w.__e2ePublish = (params: PublishParams) => publishRef.current(params)
    w.__e2eUpload = async (fileContent: string, fileName: string, type: 'public' | 'encrypted' = 'encrypted') => {
      const headers = await getAuthHeadersRef.current()
      const blob = new Blob([fileContent], { type: 'text/markdown' })
      const file = new File([blob], fileName, { type: 'text/markdown' })
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', type)
      const res = await fetch('/api/souls/upload', { method: 'POST', headers, body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Upload failed: ${res.status}`)
      }
      return res.json()
    }
    w.__e2eListSoul = async (params: {
      currentKioskId: string; currentKioskCapOnChainId: string;
      stateObjectId: string; soulObjectId: string; priceAtomic: string;
    }) => {
      const tx = buildListSoulTx({
        ...params,
        priceAtomic: BigInt(params.priceAtomic),
      })
      const result = await signAndExecuteRef.current(tx)
      const headers = await getAuthHeadersRef.current()
      const syncRes = await fetch(`/api/souls/${params.soulObjectId}/list`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest }),
      })
      if (!syncRes.ok) {
        const err = await syncRes.json().catch(() => ({}))
        throw new Error(err.error || `List sync failed: ${syncRes.status}`)
      }
      return { digest: result.digest, ...(await syncRes.json()) }
    }
    w.__e2eGetAuthHeaders = () => getAuthHeadersRef.current()
    w.__e2eIssueGrant = async (params: { stateObjectId: string; granteeAddress: string; scopeMask: number; soulObjectId: string }) => {
      const tx = buildIssueGrantTx({ stateObjectId: params.stateObjectId, granteeAddress: params.granteeAddress, scopeMask: params.scopeMask })
      const result = await signAndExecuteRef.current(tx)
      const headers = await getAuthHeadersRef.current()
      const syncRes = await fetch(`/api/souls/${params.soulObjectId}/grant`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest }),
      })
      if (!syncRes.ok) {
        const err = await syncRes.json().catch(() => ({}))
        throw new Error(err.error || `Grant sync failed: ${syncRes.status}`)
      }
      return { digest: result.digest, ...(await syncRes.json()) }
    }
    w.__e2eRevokeGrant = async (params: { stateObjectId: string; granteeAddress: string; soulObjectId: string }) => {
      const tx = buildRevokeGrantTx({ stateObjectId: params.stateObjectId, granteeAddress: params.granteeAddress })
      const result = await signAndExecuteRef.current(tx)
      const headers = await getAuthHeadersRef.current()
      const syncRes = await fetch(`/api/souls/${params.soulObjectId}/grant`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest, action: 'revoke', granteeAddress: params.granteeAddress }),
      })
      if (!syncRes.ok) {
        const err = await syncRes.json().catch(() => ({}))
        return { digest: result.digest, synced: false, error: err.error }
      }
      return { digest: result.digest, synced: true, ...(await syncRes.json()) }
    }
    return () => {
      delete w.__e2ePublish; delete w.__e2eUpload; delete w.__e2eListSoul
      delete w.__e2eGetAuthHeaders; delete w.__e2eIssueGrant; delete w.__e2eRevokeGrant
      delete w.__e2eLastRawEnvelope
    }
  }, [])

  async function handleDeploy() {
    if (!ctx.coverImageFile || !ctx.charFile || !ctx.memoryFile || !suiWallet) return

    setDeployError(null)
    ctx.setPublishResult(null)
    const walletAddress = suiWallet.address

    try {
      const authHeaders = await getAuthHeaders()
      const results: UploadResults = selectReusableUploadResults(ctx.uploadResults, walletAddress)
      const missingCachedObjectIds = new Set(await findMissingObjectIds(suiClient, [
        results.charFile?.blobObjectId,
        results.memorySeed?.blobObjectId,
        results.skillsFile?.blobObjectId,
      ]))
      if (results.charFile && missingCachedObjectIds.has(results.charFile.blobObjectId)) {
        results.charFile = undefined
      }
      if (results.memorySeed && missingCachedObjectIds.has(results.memorySeed.blobObjectId)) {
        results.memorySeed = undefined
      }
      if (results.skillsFile && missingCachedObjectIds.has(results.skillsFile.blobObjectId)) {
        results.skillsFile = undefined
      }

      // 1. Upload cover image (public, no sendObjectTo — only used as URL, not TX object)
      if (!results.coverImage) {
        setUploadPhase('uploading-cover')
        results.coverImage = await uploadFile(ctx.coverImageFile, 'public', authHeaders)
      }

      // 2. Upload character file (encrypted) — Blob object referenced in TX, must be owned by signer
      if (!results.charFile) {
        setUploadPhase('uploading-character')
        results.charFile = await uploadFile(ctx.charFile, 'encrypted', authHeaders, walletAddress)
      }

      // 3. Upload memory (encrypted) — Blob object referenced in TX, must be owned by signer
      if (!results.memorySeed) {
        setUploadPhase('uploading-memory')
        results.memorySeed = await uploadFile(ctx.memoryFile!, 'encrypted', authHeaders, walletAddress)
      }

      // 4. Upload skills file (encrypted, optional) — Blob object referenced in TX, must be owned by signer
      if (ctx.skillsFile && !results.skillsFile) {
        setUploadPhase('uploading-skills')
        results.skillsFile = await uploadFile(ctx.skillsFile, 'encrypted', authHeaders, walletAddress)
      }

      // Store upload results in context for retry support
      ctx.setUploadResults(results)
      setUploadPhase('done')

      // Expose raw DEK envelopes for E2E byte-level content verification (dev only)
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).__e2eLastRawEnvelope = {
          char: results.charFile?.sealDekEnvelope ?? null,
          memory: results.memorySeed?.sealDekEnvelope ?? null,
          skills: results.skillsFile?.sealDekEnvelope ?? null,
        }
      }

      // Narrow types — all required uploads must be present at this point
      if (!results.coverImage || !results.charFile || !results.memorySeed) {
        throw new Error('Required uploads missing')
      }
      if (!results.charFile.blobObjectId) {
        throw new Error('Character file upload was deduplicated by Walrus and no owned Blob object was created. Please modify your character file slightly and retry.')
      }
      if (!results.memorySeed.blobObjectId) {
        throw new Error('This exact memory text already exists on Walrus. Please add a unique detail to your memory so it can be stored as a distinct on-chain founding memory.')
      }
      if (typeof results.memorySeed.sealDekEnvelope !== 'string' || !results.memorySeed.sealDekEnvelope.trim()) {
        throw new Error('Memory file upload is missing Seal recovery data. Please retry.')
      }
      if (results.skillsFile && !results.skillsFile.blobObjectId) {
        throw new Error('Skills bundle upload was deduplicated by Walrus and no owned Blob object was created. Please modify your skills file slightly and retry.')
      }

      // 5. Call publish (builds TX → signs → syncs)
      const parsedTags = ctx.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      await publish({
        name: ctx.name,
        description: ctx.description,
        category: ctx.category,
        tags: parsedTags,
        imageUrl: results.coverImage.blobUrl,
        previewImages: [results.coverImage.blobUrl],
        protectedBlobObjectId: results.charFile.blobObjectId,
        foundingMemoryBlobObjectId: results.memorySeed.blobObjectId,
        skillsBlobObjectId: results.skillsFile?.blobObjectId ?? null,
        initialSkillName: results.skillsFile?.skillName ?? null,
        skillsVisibility: 'private',
        creatorRoyaltyBps: ctx.royalty,
        sealSidecar: results.charFile.sealDekEnvelope ?? null,
        memorySealSidecar: results.memorySeed.sealDekEnvelope ?? null,
        skillsSealSidecar: results.skillsFile?.sealDekEnvelope ?? null,
      })
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Deploy failed')
      setUploadPhase('idle')
    }
  }

  // Resume sync for a pending mint recovery (on-chain TX succeeded, sync failed/interrupted)
  async function handleResume() {
    if (!suiWallet || !txDigest) return
    setDeployError(null)
    try {
      // Recovery path in usePublish skips build+sign and uses stored sync body
      await publish({
        name: '', description: '', category: '', tags: [], imageUrl: '',
        previewImages: [], protectedBlobObjectId: '', creatorRoyaltyBps: 0,
      })
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Resume failed')
    }
  }

  function handleAbandonRecovery() {
    ctx.reset()
    router.replace('/create')
  }

  if (!inRecovery && status !== 'done' && (!ctx.name || !ctx.description || !ctx.coverImageFile || !ctx.charFile || !ctx.memoryFile)) return null

  const network = process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet'
  const networkLabel = network === 'mainnet' ? 'Sui Mainnet' : `Sui ${network.charAt(0).toUpperCase() + network.slice(1)}`
  const isBusy = uploadPhase !== 'idle' && uploadPhase !== 'done' || status === 'building' || status === 'signing' || status === 'syncing'
  const combinedError = deployError || error

  return (
    <div className="relative z-10 border-t border-purple/20">
      <FlowBar steps={steps} currentStep={3} />

      <PageContainer size="sm" className="space-y-5 pt-7 sm:pt-9">
        <SectionHeader
          label="Create Soul"
          title={inRecovery ? 'Step 4 — Resume Sync' : 'Step 4 — Pay Gas'}
          subtitle={inRecovery
            ? 'Your previous mint transaction succeeded. Complete the sync to finish creating your Soul.'
            : 'Your Soul will be minted as a Soul object on Sui. Review the transaction before signing.'}
          className="mb-1"
        />

        {inRecovery ? (
          <div className="rounded-2xl border border-[#F59E0B]/40 bg-[#F59E0B]/8 p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#F59E0B]">
              Pending Soul Mint
            </div>
            <p className="text-sm text-muted leading-relaxed">
              A previous mint transaction succeeded on-chain but the mirror sync was interrupted.
              Resume to complete the process, or start over to create a new Soul.
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
        {/* Transaction Preview card */}
        <div className="rounded-2xl border border-purple/30 bg-card p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#F59E0B] mb-4">
            Transaction Preview
          </div>

          <div className="divide-y divide-border/50">
            <TxRow label="Contract">
              <span className="font-mono text-teal">market::mint_native_in_personal_kiosk</span>
            </TxRow>
            <TxRow label="Network">
              <span className="font-semibold text-foreground">{networkLabel}</span>
            </TxRow>
            <TxRow label="Soul Name">
              <span className="font-semibold text-foreground">{ctx.name}</span>
            </TxRow>
            <TxRow label="Soul Character">
              <span className="text-foreground">{ctx.charFile?.name}</span>
              <span className="text-muted ml-1.5">(encrypted via Seal)</span>
            </TxRow>
            <TxRow label="Memory">
              <span className="text-foreground">{ctx.memoryFile?.name}</span>
              <span className="text-muted ml-1.5">(encrypted founding entry)</span>
            </TxRow>
            {ctx.skillsFile && (
              <TxRow label="Skills & Docs">
                <span className="text-foreground">{ctx.skillsFile.name}</span>
                <span className="text-muted ml-1.5">(Seal encrypted)</span>
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
              <span className="text-muted">Paid by publisher node</span>
            </TxRow>
          </div>
        </div>

        {/* Balance warning */}
        {!balances.loading && balanceBlocked && (
          <div className="rounded-2xl border border-danger/40 bg-danger/8 p-4 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-danger">
              Insufficient Balance
            </div>
            {suiInsufficient && (
              <p className="text-xs text-danger/90">
                SUI balance: <span className="font-mono font-semibold">{formatBalance(balances.sui!, 9)} SUI</span>
                {' '}— need at least <span className="font-semibold">0.02 SUI</span> for gas fees.
              </p>
            )}
            {suiWallet && (
              <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-black/20 px-3 py-2">
                <span className="text-[10px] text-muted shrink-0">Your address:</span>
                <code className="min-w-0 text-[11px] font-mono text-foreground">{suiWallet.address.slice(0, 20)}…{suiWallet.address.slice(-20)}</code>
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
              <p className="text-[11px] text-muted">
                Top up with SUI before deploying.
              </p>
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

        {/* Publish status (hidden until active) */}
        {(status !== 'idle' || combinedError) && (
          <div className="card px-5 py-4 space-y-3" data-testid="publish-status">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Status</span>
              <span className={`text-sm font-semibold ${
                status === 'done' ? 'text-success' :
                status === 'error' || combinedError ? 'text-danger' : 'text-purple'
              }`}>
                {uploadPhase !== 'idle' && uploadPhase !== 'done' && uploadPhaseLabels[uploadPhase]}
                {uploadPhase === 'done' && status === 'building' && '⟳ Building TX…'}
                {status === 'signing' && '⟳ Signing…'}
                {status === 'syncing' && '⟳ Syncing…'}
                {status === 'done' && '✓ Published'}
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
              <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-4 py-3">
                {combinedError}
              </div>
            )}
          </div>
        )}

        {/* Deploying overlay */}
        {isBusy && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="rounded-2xl border border-purple/30 bg-card2 p-10 text-center max-w-sm mx-4 shadow-[0_24px_60px_rgba(124,58,237,0.25)]">
              <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-purple/30 border-t-purple" />
              <h2 className="text-lg font-bold mb-2">
                {uploadPhase !== 'idle' && uploadPhase !== 'done'
                  ? 'Uploading to Walrus…'
                  : 'Deploying Soul…'}
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
                className:
                  'w-full rounded-[10px] border-purple/20 bg-transparent px-4 py-2.5 text-[13px] text-foreground hover:border-purple/45 hover:text-foreground sm:w-auto sm:min-w-[76px]',
              })}
            >
              Start Over
            </button>
          ) : (
            <Link
              href="/create/preview"
              className={buttonStyles({
                variant: 'outline',
                size: 'lg',
                className:
                  'w-full rounded-[10px] border-purple/20 bg-transparent px-4 py-2.5 text-[13px] text-foreground hover:border-purple/45 hover:text-foreground sm:w-auto sm:min-w-[76px]',
              })}
            >
              ← Back
            </Link>
          )}
          {status === 'done' ? (
            <Link
              href="/create/success"
              className={buttonStyles({ variant: 'gold', size: 'lg', full: true, className: 'rounded-[10px] px-4 py-2.5 text-[13px]' })}
            >
              Continue <span aria-hidden="true">→</span>
            </Link>
          ) : inRecovery ? (
            <button
              type="button"
              disabled={isBusy || !suiWallet || !txDigest}
              onClick={handleResume}
              className={buttonStyles({
                variant: 'gold',
                size: 'lg',
                full: true,
                className: `rounded-[10px] px-4 py-2.5 text-[13px] ${isBusy ? 'opacity-60 cursor-wait' : ''} ${!suiWallet || !txDigest ? 'opacity-50 cursor-not-allowed' : ''}`,
              })}
            >
              {!suiWallet
                ? 'No Sui Wallet Connected'
                : !txDigest
                  ? 'Loading recovery…'
                  : isBusy
                    ? `${status}…`
                    : 'Resume Sync'}
            </button>
          ) : (
            <button
              type="button"
              disabled={isBusy || balanceBlocked || !suiWallet}
              onClick={handleDeploy}
              className={buttonStyles({
                variant: 'gold',
                size: 'lg',
                full: true,
                className: `rounded-[10px] px-4 py-2.5 text-[13px] ${isBusy ? 'opacity-60 cursor-wait' : ''} ${balanceBlocked || !suiWallet ? 'opacity-50 cursor-not-allowed' : ''}`,
              })}
            >
              {!suiWallet
                ? 'No Sui Wallet Connected'
                : balanceBlocked
                  ? 'Insufficient Balance'
                  : isBusy
                    ? (uploadPhaseLabels[uploadPhase] || `${status}…`)
                    : '✓ Sign & Deploy'}
            </button>
          )}
        </div>
      </PageContainer>
    </div>
  )
}
