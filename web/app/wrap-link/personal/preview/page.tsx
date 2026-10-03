'use client'

import { AuthoringRecoveryExport } from '@/components/souls/authoring-recovery-export'

import { useEffect, useRef, useState } from 'react'
import { useAutoConnectWallet, useCurrentWallet } from '@mysten/dapp-kit'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Button, buttonStyles } from '@/components/ui/button'
import { useWrap, wrapSteps } from '@/components/providers/wrap-provider'
import { useKioskNfts } from '@/lib/hooks/use-kiosk-nfts'
import { useWrapPublish } from '@/lib/hooks/use-wrap-publish'
import { useAuth } from '@/components/providers/auth-provider'
import { useLogin } from '@/lib/hooks/use-login'
import { getWalletActionState } from '@/lib/wallet/wallet-action-state'

import { Modal } from '@/components/ui/modal'
import { TxRow } from '@/components/shared/tx-row'
import { formatWal } from '@/components/upload/upload-cost-review'
import { soulAuthoringCostReview } from '@/lib/soulidity/soul-authoring-cost-review'
import type { SoulAuthoringPacketRecord } from '@/lib/soulidity/soul-authoring-packet'

type Approval = { review: ReturnType<typeof soulAuthoringCostReview>; finish: (accepted: boolean) => void }

const statusLabels: Record<string, string> = {
  uploading: 'Uploading Soul files to Walrus…',
  building: 'Building wrap transaction…',
  signing: 'Waiting for wallet signature…',
  syncing: 'Syncing on-chain state…',
}

export default function PreviewSignPage() {
  const router = useRouter()
  const ctx = useWrap()
  const { setPublishResult } = ctx
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
  const { status, error, txDigest, result, publish, suiWallet, recovery, loadingRecovery,
    query, resume, retryPacket, retryFailed, retireExpired, exportRecovery, exportingRecovery } = useWrapPublish(approve)
  const { user } = useAuth()
  const walletConnection = useCurrentWallet()
  const autoConnectStatus = useAutoConnectWallet()
  const openWalletLogin = useLogin()
  const { data: nfts } = useKioskNfts(suiWallet?.address)
  const completedDigestRef = useRef<string | null>(null)

  const hasPendingRecovery = Boolean(recovery)
  const selectedNftAvailable = !!ctx.selectedNft && (!nfts || nfts.some((nft) => nft.objectId === ctx.selectedNft?.objectId))
  const missingStep1 = !ctx.selectedNft || (!hasPendingRecovery && nfts != null && !selectedNftAvailable)
  const missingStep2 = !ctx.charFile || !ctx.memoryFile
  const isRecoveryMode = hasPendingRecovery && status !== 'done'

  useEffect(() => {
    if (loadingRecovery || !suiWallet || status !== 'idle') return
    if (!hasPendingRecovery && ctx.selectedNft && nfts && !selectedNftAvailable) {
      ctx.setSelectedNft(null)
      router.replace('/wrap-link/personal')
      return
    }
    if (missingStep1 && !hasPendingRecovery) {
      router.replace('/wrap-link/personal')
    } else if (missingStep2 && !hasPendingRecovery) {
      router.replace('/wrap-link/personal/configure')
    }
  }, [loadingRecovery, suiWallet, status, ctx, ctx.selectedNft, nfts, selectedNftAvailable, missingStep1, missingStep2, hasPendingRecovery, router])

  useEffect(() => {
    if (status === 'done' && result) {
      if (completedDigestRef.current === result.txDigest) return
      completedDigestRef.current = result.txDigest
      setPublishResult(result)
      router.push('/wrap-link/personal/success')
    }
  }, [status, result, setPublishResult, router])

  const isBusy = loadingRecovery || exportingRecovery || status !== 'idle' && status !== 'done' && status !== 'error'
  const walletRestoring = !suiWallet && (walletConnection.isConnecting || autoConnectStatus === 'idle')
  const walletActionState = getWalletActionState({
    hasActiveWallet: !!suiWallet,
    hasSessionWallet: !!user?.primarySuiAddress,
    walletRestoring,
    busy: isBusy,
    busyLabel: statusLabels[status] ?? 'Processing...',
    balanceBlocked: false,
    recovery: false,
    txDigest,
    readyLabel: isRecoveryMode ? retryPacket ? retryPacket.retired ? 'Retry Retired Transaction' : 'Retry Failed Transaction' : 'Resume Saved Wrap' : 'Sign & Expand Soul',
  })

  if (loadingRecovery) return <p role="status">Reading saved wrap…</p>
  if (suiWallet && (missingStep1 || missingStep2) && !hasPendingRecovery) return null

  async function handleSign() {
    if (isRecoveryMode) {
      await (retryPacket ? retryFailed() : resume())
      return
    }

    if (!ctx.selectedNft || !ctx.charFile || !ctx.memoryFile) return
    await publish({
      nft: ctx.selectedNft!,
      charFile: ctx.charFile!,
      memoryFile: ctx.memoryFile!,
      skillsFile: ctx.skillsFile,
      royalty: ctx.royalty,
    })
  }

  function handleSignAction() {
    if (walletActionState.needsWalletReconnect) {
      openWalletLogin()
      return
    }
    void handleSign()
  }

  return (
    <>
      <FlowBar steps={wrapSteps} currentStep={2} />
      <div className="relative z-10 border-t border-purple/20">
        <PageContainer size="sm" className="space-y-6 pt-7 sm:pt-9">
          <SectionHeader
            label="Personal Join"
            title="Preview & Sign"
            subtitle="Review the wrap details and sign the transaction."
            className="mb-2"
          />

          {isRecoveryMode ? (
            <div className="rounded-2xl border border-purple/40 bg-card2/55 p-5 space-y-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-action-label">Pending Recovery</p>
                <h3 className="mt-1 text-lg font-bold text-foreground">Resume your saved wrap</h3>
                <p className="mt-2 text-sm text-muted">
                  Check the saved transaction before continuing. An unknown result is not success; confirmed storage and the original content identity are reused.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card/40 px-4 py-3 text-xs">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted">Pending TX</span>
                  <span className="font-mono text-teal">{txDigest ? `${txDigest.slice(0, 12)}…${txDigest.slice(-4)}` : 'Prepared; no transaction yet'}</span>
                </div>
              </div>
            </div>
          ) : ctx.selectedNft && ctx.charFile && ctx.memoryFile ? (
            <div className="rounded-2xl border border-purple/40 bg-card2/55 p-5 space-y-4">
              <div className="flex items-center gap-4">
                {ctx.selectedNft!.imageUrl ? (
                  <Image src={ctx.selectedNft!.imageUrl} alt={ctx.selectedNft!.name} width={64} height={64} unoptimized className="h-16 w-16 shrink-0 rounded-xl border border-purple/30 object-cover" />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-purple/20 text-2xl font-bold text-action-label">
                    {ctx.selectedNft!.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div>
                  <h3 className="text-lg font-bold text-foreground">{ctx.selectedNft!.name}</h3>
                  <p className="text-xs text-muted font-mono">{ctx.selectedNft!.objectType.split('::').slice(-1)[0]}</p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Soul Layers Being Added</p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground">Soul Character</span>
                    <span className="text-teal font-semibold">{ctx.charFile!.name} · ✓</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground">Memory</span>
                    <span className="text-teal font-semibold">{ctx.memoryFile!.name} · ✓</span>
                  </div>
                  {ctx.skillsFile && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-foreground">Skills & Docs</span>
                      <span className="text-teal font-semibold">{ctx.skillsFile.name} · ✓</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : <p>Connect the creating wallet to load its saved wrap.</p>}

          {/* On-chain details */}
          <div className="rounded-2xl border border-border bg-card2/55 p-5">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">On-Chain Details</p>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Wrap Type</span>
                <span className="font-semibold text-foreground">Personal · mint_joined_in_personal_kiosk_v2</span>
              </div>
              {(recovery?.manifest.request.mints[0].source || ctx.selectedNft) && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">Source NFT</span>
                  <span className="font-mono text-foreground">{(recovery?.manifest.request.mints[0].source?.objectId ?? ctx.selectedNft!.objectId)}</span>
                </div>
              )}
              {txDigest && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">Pending TX</span>
                  <span className="font-mono text-foreground">{txDigest.slice(0, 12)}…{txDigest.slice(-4)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Character Storage</span>
                <span className="text-foreground">Walrus (Seal encrypted)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Provenance</span>
                <span className="text-foreground">personal-join</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Gas & Storage</span>
                <span className="font-semibold text-foreground">Reviewed before each signature</span>
              </div>
            </div>
          </div>

          {/* After signing notes */}
          <div className="rounded-xl border border-border bg-card2/55 px-4 py-3">
            <p className="text-[11px] font-bold text-muted mb-1.5">After signing:</p>
            <ul className="text-[11px] text-muted leading-5 space-y-0.5">
              <li>1. A Soul layer is registered on Sui and linked to your NFT.</li>
              <li>2. Soul Character is stored on Walrus under Seal encryption.</li>
              <li>3. Your NFT now appears as a Soul on Soulidity.</li>
            </ul>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
              <p className="text-[13px] font-medium text-danger">{error}</p>
            </div>
          )}

          {isRecoveryMode && <div className="flex flex-wrap gap-3">
            <AuthoringRecoveryExport disabled={isBusy || !suiWallet} onExport={exportRecovery} />
            <Button disabled={isBusy || !suiWallet} onClick={() => void query()}>Check Saved Transaction</Button>
            {txDigest && !retryPacket && <Button disabled={isBusy || !suiWallet} onClick={() => void retireExpired()}>Check Expiry &amp; Retire</Button>}
          </div>}
          {/* Actions */}
          <div className="flex items-center gap-3">
            {!isRecoveryMode && (
              <Link
                href="/wrap-link/personal/configure"
                className={buttonStyles({
                  variant: 'outline',
                  size: 'lg',
                  className: 'w-[112px] rounded-xl border-border bg-transparent text-foreground hover:border-purple',
                })}
              >
                ← Back
              </Link>
            )}
            <button
              type="button"
              disabled={walletActionState.disabled}
              onClick={handleSignAction}
              className={buttonStyles({
                variant: isRecoveryMode ? 'primary' : 'gold',
                size: 'lg',
                className: `min-w-0 ${isRecoveryMode ? 'w-full' : 'flex-1'} rounded-xl ${isBusy ? 'opacity-60 cursor-wait' : ''} ${walletActionState.disabled ? 'opacity-50 cursor-not-allowed' : ''}`,
              })}
            >
              {walletActionState.label}
              {!walletActionState.disabled && !walletActionState.needsWalletReconnect && (
                <span aria-hidden="true"> →</span>
              )}
            </button>
          </div>
        </PageContainer>
      </div>

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

      {/* Signing overlay */}
      {isBusy && !approval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 rounded-2xl border border-purple/40 bg-[linear-gradient(135deg,rgba(28,17,63,0.97),rgba(18,10,41,0.98))] px-14 py-10 text-center shadow-[0_24px_64px_rgba(124,58,237,0.3)]">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-purple/30 border-t-purple" />
            <h3 className="text-lg font-bold text-foreground">Expanding Soul…</h3>
            <p className="mt-1.5 text-sm text-muted">{statusLabels[status] ?? 'Processing…'}</p>
          </div>
        </div>
      )}
    </>
  )
}
