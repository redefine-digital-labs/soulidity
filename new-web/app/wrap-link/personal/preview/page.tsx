'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'
import { useWrap, wrapSteps } from '@/components/providers/wrap-provider'
import { useWrapPublish } from '@/lib/hooks/use-wrap-publish'

const statusLabels: Record<string, string> = {
  uploading: 'Uploading Soul files to Walrus…',
  building: 'Building wrap transaction…',
  signing: 'Waiting for wallet signature…',
  syncing: 'Syncing on-chain state…',
}

export default function PreviewSignPage() {
  const router = useRouter()
  const ctx = useWrap()
  const { status, error, txDigest, result, publish, suiWallet } = useWrapPublish()

  const missingStep1 = !ctx.selectedNft
  const missingStep2 = !ctx.charFile || !ctx.memoryFile
  const hasPendingRecovery = Boolean(txDigest)
  const isRecoveryMode = hasPendingRecovery && (missingStep1 || missingStep2)

  useEffect(() => {
    if (missingStep1 && !hasPendingRecovery) {
      router.replace('/wrap-link/personal')
    } else if (missingStep2 && !hasPendingRecovery) {
      router.replace('/wrap-link/personal/configure')
    }
  }, [missingStep1, missingStep2, hasPendingRecovery, router])

  useEffect(() => {
    if (status === 'done' && result) {
      ctx.setPublishResult(result)
      router.push('/wrap-link/personal/success')
    }
  }, [status, result, ctx, router])

  if ((missingStep1 || missingStep2) && !hasPendingRecovery) return null

  const isBusy = status !== 'idle' && status !== 'done' && status !== 'error'

  async function handleSign() {
    if (isRecoveryMode) {
      await publish()
      return
    }

    await publish({
      nft: ctx.selectedNft!,
      charFile: ctx.charFile!,
      memoryFile: ctx.memoryFile!,
      skillsFile: ctx.skillsFile,
      royalty: ctx.royalty,
    })
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
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-purple">Pending Recovery</p>
                <h3 className="mt-1 text-lg font-bold text-foreground">Resume sync for the already-minted Soul</h3>
                <p className="mt-2 text-sm text-muted">
                  This wrap transaction already succeeded on-chain. Retrying here will only resume the mirror step and will not mint again.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card/40 px-4 py-3 text-xs">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted">Pending TX</span>
                  <span className="font-mono text-teal">{txDigest!.slice(0, 12)}…{txDigest!.slice(-4)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-purple/40 bg-card2/55 p-5 space-y-4">
              <div className="flex items-center gap-4">
                {ctx.selectedNft!.imageUrl ? (
                  <img src={ctx.selectedNft!.imageUrl} alt={ctx.selectedNft!.name} className="h-16 w-16 shrink-0 rounded-xl border border-purple/30 object-cover" />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-purple/20 text-2xl font-bold text-purple">
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
                    <span className="text-foreground">Memory Seed</span>
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
          )}

          {/* On-chain details */}
          <div className="rounded-2xl border border-border bg-card2/55 p-5">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">On-Chain Details</p>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Wrap Type</span>
                <span className="font-semibold text-foreground">Personal · mint_joined_in_personal_kiosk</span>
              </div>
              {ctx.selectedNft && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">Source NFT</span>
                  <span className="font-mono text-foreground">{ctx.selectedNft.objectId.slice(0, 10)}…{ctx.selectedNft.objectId.slice(-4)}</span>
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
                <span className="text-muted">Est. Gas</span>
                <span className="font-semibold text-foreground">~0.035 SUI</span>
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
              disabled={isBusy || !suiWallet}
              onClick={handleSign}
              className={buttonStyles({
                variant: isRecoveryMode ? 'primary' : 'gold',
                size: 'lg',
                className: `min-w-0 ${isRecoveryMode ? 'w-full' : 'flex-1'} rounded-xl ${isBusy ? 'opacity-60 cursor-wait' : ''} ${!suiWallet ? 'opacity-50 cursor-not-allowed' : ''}`,
              })}
            >
              {!suiWallet
                ? 'No Wallet Connected'
                : isBusy
                  ? (statusLabels[status] ?? 'Processing…')
                  : isRecoveryMode
                    ? <>Resume Sync <span aria-hidden="true">→</span></>
                    : <>Sign &amp; Expand Soul <span aria-hidden="true">→</span></>}
            </button>
          </div>
        </PageContainer>
      </div>

      {/* Signing overlay */}
      {isBusy && (
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
