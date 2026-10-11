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
import { TxRow } from '@/components/shared/tx-row'
import { formatBalance, minimumSuiBalanceForWalletTransactions, useWalletBalances } from '@/lib/hooks/use-wallet-balances'
import { useImport } from '@/lib/hooks/use-import'
import { useAuth } from '@/components/providers/auth-provider'
import { useLogin } from '@/lib/hooks/use-login'
import { getWalletActionState } from '@/lib/wallet/wallet-action-state'
import { useImportSoul } from '@/components/providers/import-soul-provider'
import { formatWal } from '@/components/upload/upload-cost-review'
import { soulAuthoringCostReview } from '@/lib/soulidity/soul-authoring-cost-review'
import type { SoulAuthoringPacketRecord } from '@/lib/soulidity/soul-authoring-packet'

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

type Approval = { review: ReturnType<typeof soulAuthoringCostReview>; finish: (accepted: boolean) => void }

export default function ImportGasPage() {
  const router = useRouter(), ctx = useImportSoul(), { user } = useAuth()
  const { setImportResult } = ctx
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
  const { status, error, txDigest, importData, importSoul, suiWallet, recovery, loadingRecovery,
    query, resume, retryPacket, retryFailed, retireExpired, exportRecovery, exportingRecovery } = useImport(approve)
  const walletConnection = useCurrentWallet(), autoConnectStatus = useAutoConnectWallet(), openWalletLogin = useLogin()
  const [copied, setCopied] = useState(false)
  const completedDigestRef = useRef<string | null>(null)
  const balances = useWalletBalances(suiWallet?.address ?? null)
  const minImportSuiBalance = minimumSuiBalanceForWalletTransactions(2)
  const suiInsufficient = balances.sui !== null && balances.sui < minImportSuiBalance
  const balanceBlocked = suiInsufficient
  const missing = !ctx.resolvedName || !ctx.resolvedDescription || !ctx.coverImageFile || !ctx.charFile || !ctx.memoryFile
  const inRecovery = Boolean(recovery) && status !== 'done'
  useEffect(() => {
    if (suiWallet && !loadingRecovery && !recovery && status === 'idle' && missing) router.replace('/import/map')
  }, [suiWallet?.address, loadingRecovery, recovery, status, missing, router])
  useEffect(() => {
    if (status !== 'done' || !importData || completedDigestRef.current === importData.txDigest) return
    completedDigestRef.current = importData.txDigest
    setImportResult(importData); router.replace('/import/success')
  }, [status, importData, setImportResult, router])
  async function handleDeploy() {
    if (!ctx.coverImageFile || !ctx.charFile || !ctx.memoryFile) return
    await importSoul({ name: ctx.resolvedName, description: ctx.resolvedDescription,
      tags: ctx.tags.split(',').map(t => t.trim()).filter(Boolean), creatorRoyaltyBps: ctx.royalty,
      originRef: ctx.originRef, cover: withMime(ctx.coverImageFile), character: withMime(ctx.charFile),
      memory: withMime(ctx.memoryFile), skills: ctx.skillsFile ? withMime(ctx.skillsFile) : null })
  }
  const networkLabel = 'Sui Mainnet'
  const isBusy = loadingRecovery || exportingRecovery || ['building', 'signing', 'syncing'].includes(status)
  const combinedError = error
  const walletRestoring = !suiWallet && (walletConnection.isConnecting || autoConnectStatus === 'idle')
  const walletActionState = getWalletActionState({ hasActiveWallet: !!suiWallet, hasSessionWallet: !!user?.primarySuiAddress,
    walletRestoring, busy: isBusy, busyLabel: loadingRecovery ? 'Reading saved import…' : 'Importing Soul…',
    balanceBlocked: inRecovery ? false : balanceBlocked, recovery: false, txDigest,
    readyLabel: inRecovery ? retryPacket ? retryPacket.retired ? 'Retry Retired Transaction' : 'Retry Failed Transaction' : 'Resume Saved Import' : '✓ Sign & Deploy' })
  function handleWalletAction(action: () => void | Promise<void>) {
    if (walletActionState.needsWalletReconnect) { openWalletLogin(); return }
    void action()
  }

  return (
    <div className="relative z-10 border-t border-purple/20">
      <FlowBar steps={steps} currentStep={4} />

      <PageContainer size="sm" className="space-y-5 pt-7 sm:pt-9">
        <SectionHeader
          label="Import Soul"
          title={inRecovery ? 'Step 5 — Resume Import' : 'Step 5 — Pay Gas'}
          subtitle={inRecovery
            ? 'Your saved import is retained. Check its original transaction or explicitly resume it.'
            : 'Your imported Soul will be minted on Sui. Review the transaction before signing.'}
          className="mb-1"
        />

        {inRecovery ? (
          <div className="space-y-3 rounded-2xl border border-[#F59E0B]/40 bg-[#F59E0B]/8 p-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#F59E0B]">
              Pending Soul Import
            </div>
            <p className="text-sm leading-relaxed text-muted">
              This import has a saved identity and encrypted preparation. Query or resume the same operation;
              a missing receipt does not mean payment failed.
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
                  <span className="font-mono text-teal">market::mint_imported_in_personal_kiosk_v2</span>
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
                  <span className="rounded-full border border-purple/30 bg-purple/15 px-2 py-0.5 text-[10px] font-bold text-action-label">
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
                  : status === 'error' ? 'text-danger'
                    : 'text-action-label'
              }`}>
                {status === 'idle' && 'Awaiting your next action'}
                {status === 'building' && 'Preparing saved import…'}
                {status === 'signing' && '⟳ Signing…'}
                {status === 'syncing' && '⟳ Checking original transaction…'}
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
                {status === 'syncing' ? 'Checking transaction…' : 'Importing Soul…'}
              </h2>
              <p className="text-sm text-muted">
                {status === 'signing' ? 'Review the exact transaction before confirming in your wallet.' : 'Your saved import is retained during this operation.'}
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
              disabled={walletActionState.disabled}
              onClick={() => handleWalletAction(query)}
              className={buttonStyles({
                variant: 'outline',
                size: 'lg',
                className: 'w-full rounded-[10px] border-purple/20 bg-transparent px-4 py-2.5 text-[13px] text-foreground hover:border-purple/45 hover:text-foreground sm:w-auto sm:min-w-[76px]',
              })}
            >
              Check Transaction
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
          {inRecovery && txDigest && !retryPacket && <button type="button" disabled={walletActionState.disabled}
            onClick={() => handleWalletAction(retireExpired)}
            className={buttonStyles({ variant: 'outline', size: 'lg' })}>Check Expiry &amp; Retire</button>}
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
