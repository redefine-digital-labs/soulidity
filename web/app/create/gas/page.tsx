'use client'

import { AuthoringRecoveryExport } from '@/components/souls/authoring-recovery-export'

import { useEffect, useRef, useState } from 'react'
import { useAutoConnectWallet, useCurrentWallet } from '@mysten/dapp-kit'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Button, buttonStyles } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { usePublish } from '@/lib/hooks/use-publish'
import { useAuth } from '@/components/providers/auth-provider'
import { useLogin } from '@/lib/hooks/use-login'
import { getWalletActionState } from '@/lib/wallet/wallet-action-state'
import { useCreateSoul } from '@/components/providers/create-soul-provider'
import { TxRow } from '@/components/shared/tx-row'
import { MIN_SUI_BALANCE, formatBalance, useWalletBalances } from '@/lib/hooks/use-wallet-balances'
import { formatWal } from '@/components/upload/upload-cost-review'
import { soulAuthoringCostReview } from '@/lib/soulidity/soul-authoring-cost-review'
import type { SoulAuthoringPacketRecord } from '@/lib/soulidity/soul-authoring-packet'

const steps = [{ label: 'Basic Info' }, { label: 'Living Content' }, { label: 'Preview & Confirm' },
  { label: 'Pay Gas' }, { label: 'On-chain' }]
const royaltyLabels: Record<number, string> = {
  0: 'Off · 0% (locked on-chain)', 250: 'Low · 2.5% (locked on-chain)',
  500: 'Standard · 5% (locked on-chain)', 1000: 'High · 10% (locked on-chain)',
}
const MIME_MAP: Record<string, string> = {
  '.md': 'text/markdown', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json', '.zip': 'application/zip',
}
function withMime(file: File): File {
  const ext = file.name.includes('.') ? '.' + file.name.split('.').pop()!.toLowerCase() : ''
  const expected = MIME_MAP[ext]
  return !expected || file.type === expected ? file : new File([file], file.name, { type: expected })
}
type Approval = { review: ReturnType<typeof soulAuthoringCostReview>; finish: (accepted: boolean) => void }

export default function CreateGasPage() {
  const router = useRouter(), ctx = useCreateSoul(), { user } = useAuth(), { showToast } = useToast()
  const openWalletLogin = useLogin(), walletConnection = useCurrentWallet(), autoConnectStatus = useAutoConnectWallet()
  const [approval, setApproval] = useState<Approval | null>(null)
  const approvalRef = useRef<Approval | null>(null)
  const approve = (record: SoulAuthoringPacketRecord, signal: AbortSignal) => {
    const review = soulAuthoringCostReview(record)
    approvalRef.current?.finish(false)
    if (signal.aborted) return Promise.resolve(false)
    return new Promise<boolean>(resolve => {
      const close = () => entry.finish(false)
      const entry: Approval = { review, finish: accepted => {
        if (approvalRef.current !== entry) return
        signal.removeEventListener('abort', close); approvalRef.current = null
        setApproval(null); resolve(accepted && !signal.aborted)
      } }
      approvalRef.current = entry; setApproval(entry)
      signal.addEventListener('abort', close, { once: true })
    })
  }
  useEffect(() => () => { approvalRef.current?.finish(false) }, [])
  const { status, error, txDigest, publishData, publish, resume, query, retryFailed, retryPacket, retireExpired, suiWallet, recovery, loadingRecovery, exportRecovery, exportingRecovery } = usePublish(approve)
  const completedDigestRef = useRef<string | null>(null)
  const [copied, setCopied] = useState(false)
  const balances = useWalletBalances(suiWallet?.address ?? null)
  const suiInsufficient = balances.sui !== null && balances.sui < MIN_SUI_BALANCE
  const balanceBlocked = suiInsufficient
  const inRecovery = Boolean(recovery) && status !== 'done'
  const missingStep1 = !ctx.name || !ctx.description || !ctx.coverImageFile
  const missingStep2 = !ctx.charFile || !ctx.memoryFile
  useEffect(() => {
    if (!suiWallet || loadingRecovery || recovery || status !== 'idle') return
    if (missingStep1) router.replace(ctx.collectionBindTarget ? `/create?collectionId=${encodeURIComponent(ctx.collectionBindTarget.collectionOnChainId)}` : '/create')
    else if (missingStep2) router.replace('/create/content')
  }, [suiWallet?.address, loadingRecovery, recovery, status, missingStep1, missingStep2, router, ctx.collectionBindTarget?.collectionOnChainId])
  useEffect(() => {
    if (status !== 'done' || !publishData || completedDigestRef.current === publishData.txDigest) return
    completedDigestRef.current = publishData.txDigest
    ctx.setPublishResult(publishData); showToast('Soul minted successfully!', 'success')
    try {
      const token = sessionStorage.getItem('soulidity-desktop-handoff-token')
      if (token) {
        sessionStorage.removeItem('soulidity-desktop-handoff-token')
        window.location.href = `soulidity://mint-completed?token=${encodeURIComponent(token)}`
      }
    } catch { /* The browser may not support the desktop scheme. */ }
    router.replace('/create/success')
  }, [status, publishData, ctx.setPublishResult, router, showToast])
  const handleDeploy = async () => {
    if (!ctx.coverImageFile || !ctx.charFile || !ctx.memoryFile) return
    await publish({ name: ctx.name, description: ctx.description, tags: ctx.tags.split(',').map(tag => tag.trim()).filter(Boolean),
      creatorRoyaltyBps: ctx.royalty, cover: withMime(ctx.coverImageFile), character: withMime(ctx.charFile),
      memory: withMime(ctx.memoryFile), skills: ctx.skillsFile ? withMime(ctx.skillsFile) : null,
      collectionBindTarget: ctx.collectionBindTarget, listOnPublish: ctx.listOnPublish, listingPriceAtomic: ctx.listingPriceAtomic })
  }
  const networkLabel = 'Sui Mainnet'
  const isBusy = loadingRecovery || exportingRecovery || ['building', 'signing', 'syncing'].includes(status)
  const combinedError = error
  const walletRestoring = !suiWallet && (walletConnection.isConnecting || autoConnectStatus === 'idle')
  const walletActionState = getWalletActionState({
    hasActiveWallet: !!suiWallet, hasSessionWallet: !!user?.primarySuiAddress, walletRestoring,
    busy: isBusy, busyLabel: loadingRecovery ? 'Reading saved creation…' : 'Creating Soul…',
    balanceBlocked: inRecovery ? false : balanceBlocked,
    // A saved pre-payment preparation has no digest yet but is still resumable.
    recovery: false, txDigest, readyLabel: inRecovery ? retryPacket ? retryPacket.retired ? 'Retry Retired Transaction' : 'Retry Failed Transaction' : 'Resume Saved Creation' : '✓ Sign & Deploy',
  })
  function handleWalletAction(action: () => void | Promise<void>) {
    if (walletActionState.needsWalletReconnect) { openWalletLogin(); return }
    void action()
  }

  return (
    <div className="relative z-10 border-t border-purple/20">
      <FlowBar steps={steps} currentStep={3} />

      <PageContainer size="sm" className="space-y-5 pt-7 sm:pt-9">
        <SectionHeader
          label="Create Soul"
          title={inRecovery ? 'Step 4 — Resume Creation' : 'Step 4 — Pay Gas'}
          subtitle={inRecovery
            ? 'Your saved creation is retained. Check its original transaction or explicitly resume it.'
            : 'Your Soul will be minted as a Soul object on Sui. Review the transaction before signing.'}
          className="mb-1"
        />

        {inRecovery ? (
          <div className="space-y-3 rounded-2xl border border-[var(--ui-value)] bg-[var(--ui-soft-value)] p-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--ui-value-text)]">
              Pending Soul Mint
            </div>
            <p className="text-sm text-muted leading-relaxed">
              This creation has a saved identity and encrypted upload data. Its transaction may still be pending.
              Resuming uses the same operation; a missing receipt does not mean payment failed.
            </p>
            {txDigest && (
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-[var(--ui-surface-muted)] px-3 py-2">
                <span className="text-[10px] text-muted">TX Digest</span>
                <span className="font-mono text-xs text-tech-text">{txDigest.slice(0, 16)}…</span>
              </div>
            )}
          </div>
        ) : (
          <>
        {/* Transaction Preview card */}
        <div className="rounded-2xl border border-purple/30 bg-card p-5">
          <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--ui-value-text)]">
            Transaction Preview
          </div>

          <div className="divide-y divide-border/50">
            <TxRow label="Contract">
              <span className="font-mono text-tech-text">market::mint_native_in_personal_kiosk_v2</span>
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
              <span className="font-semibold text-[var(--ui-value-text)]">
                {royaltyLabels[ctx.royalty] ?? `${ctx.royalty / 100}% (locked on-chain)`}
              </span>
            </TxRow>
            <TxRow label="Soul Policy" align="top">
              <span className="text-muted leading-relaxed">
                Character locked after mint · Grant-gated memory writes · Skills private by default · Revocable
              </span>
            </TxRow>
            <TxRow label="Gas budget">
              <span className="text-foreground">Reviewed for each transaction before signing</span>
            </TxRow>
            <TxRow label="Walrus Storage">
              <span className="text-muted">Paid by connected wallet after cost review</span>
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
                {' '}— need at least <span className="font-semibold">0.04 SUI</span> for gas fees.
              </p>
            )}
            {suiWallet && (
              <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-[var(--ui-surface-muted)] px-3 py-2">
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
                status === 'error' ? 'text-danger' : 'text-action-label'
              }`}>
                {status === 'building' && 'Preparing saved creation…'}
                {status === 'idle' && 'Awaiting your next action'}
                {false}
                {status === 'signing' && '⟳ Signing…'}
                {status === 'syncing' && '⟳ Checking original transaction…'}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ui-overlay)]">
            <div className="mx-4 max-w-sm rounded-[var(--ui-radius-lg)] border border-[var(--ui-action)] bg-[var(--ui-surface)] p-10 text-center shadow-[var(--ui-shadow-md)]">
              <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-purple/30 border-t-purple" />
              <h2 className="text-lg font-bold mb-2">
                {status === 'syncing' ? 'Checking transaction…' : 'Creating Soul…'}
              </h2>
              <p className="text-sm text-muted">
                {status === 'signing' ? 'Review the exact transaction and confirm in your wallet.'
                  : 'Your operation is saved. Keep this page open while it is processing.'}
              </p>
            </div>
          </div>
        )}

        {/* Navigation */}
        {inRecovery && <AuthoringRecoveryExport disabled={isBusy || !suiWallet} onExport={exportRecovery} />}
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
          {inRecovery ? (
            <button
              type="button"
              disabled={isBusy} onClick={() => void query()}
              className={buttonStyles({
                variant: 'outline',
                size: 'lg',
                className:
                  'w-full rounded-[10px] border-purple/20 bg-transparent px-4 py-2.5 text-[13px] text-foreground hover:border-purple/45 hover:text-foreground sm:w-auto sm:min-w-[76px]',
              })}
            >
              Check Transaction
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
          {inRecovery && txDigest && !retryPacket && (
            <button type="button" disabled={walletActionState.disabled}
              onClick={() => handleWalletAction(retireExpired)}
              className={buttonStyles({ variant: 'outline', size: 'lg', className: 'rounded-[10px] px-4 py-2.5 text-[13px]' })}>
              Check Expiry &amp; Retire
            </button>
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
              disabled={walletActionState.disabled}
              onClick={() => handleWalletAction(retryPacket ? retryFailed : resume)}
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
      <Modal open={Boolean(approval)} onClose={() => approval?.finish(false)} title="Review Creation Transaction"
        subtitle="Confirm this saved transaction before opening your wallet. Storage registration and Soul mint are separate transactions.">
        {approval && <div className="space-y-4 text-sm">
          <TxRow label="Stage">{approval.review.stage === 'REGISTER' ? 'Pay for storage' : 'Certify content & mint Soul'}</TxRow>
          <TxRow label="WAL payment">{formatWal(approval.review.wal)}</TxRow>
          <TxRow label="Maximum gas">{approval.review.gasBudgetMist.toString()} MIST</TxRow>
          <TxRow label="Expires after epoch">{approval.review.expirationEpoch}</TxRow>
          <div className="break-all font-mono text-xs">{approval.review.digest}</div>
          <p className="text-muted">Cancelling retains the saved creation. It does not delete paid storage or create a replacement transaction.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => approval.finish(false)}>Cancel</Button>
            <Button variant="gold" onClick={() => approval.finish(true)}>Continue to Wallet</Button>
          </div>
        </div>}
      </Modal>
    </div>
  )
}
