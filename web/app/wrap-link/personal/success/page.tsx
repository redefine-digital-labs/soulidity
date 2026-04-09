'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { buttonStyles } from '@/components/ui/button'
import { useWrap, wrapSteps } from '@/components/providers/wrap-provider'

export default function WrapSuccessPage() {
  const router = useRouter()
  const ctx = useWrap()

  useEffect(() => {
    if (!ctx.publishResult) {
      router.replace('/wrap-link/personal')
    }
  }, [ctx.publishResult, router])

  if (!ctx.publishResult) return null

  const { txDigest, soulOnChainId, provenanceKind, originRef } = ctx.publishResult
  const nft = ctx.selectedNft

  return (
    <>
      <FlowBar steps={wrapSteps} currentStep={3} />
      <div className="relative z-10 border-t border-purple/20">
        <PageContainer size="sm" className="py-12 text-center space-y-6">
          {/* Icon */}
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teal/15 text-3xl">
            🔗
          </div>

          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">Soul Expanded</h1>
            <p className="mt-2 text-sm text-muted">
              Your NFT now carries a Soul layer on Soulidity. The original NFT is unchanged.
            </p>
          </div>

          {/* Confirmation card */}
          <div className="mx-auto max-w-md rounded-2xl border border-purple/30 bg-card2/55 p-5 text-left">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
              On-Chain Confirmation
            </p>

            {nft && (
              <div className="flex items-center gap-3 mb-4">
                {nft.imageUrl ? (
                  <img src={nft.imageUrl} alt={nft.name} className="h-10 w-10 shrink-0 rounded-lg border border-border/50 object-cover" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple/20 text-sm font-bold text-purple">
                    {nft.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="text-sm font-bold text-foreground">{nft.name}</span>
              </div>
            )}

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted">Soul Object</span>
                <span className="font-mono text-teal">{soulOnChainId.slice(0, 10)}…{soulOnChainId.slice(-4)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Wrap Type</span>
                <span className="font-semibold text-foreground">{provenanceKind}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Origin Ref</span>
                <span className="font-mono text-foreground">{originRef.slice(0, 16)}…</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">TX</span>
                <span className="font-mono text-teal">{txDigest.slice(0, 12)}…</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Status</span>
                <span className="font-semibold text-teal">Live on Sui</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/my-souls"
              className={buttonStyles({ variant: 'primary', size: 'lg', className: 'rounded-xl' })}
            >
              View My Souls
            </Link>
            <Link
              href="/market"
              className={buttonStyles({ variant: 'outline', size: 'lg', className: 'rounded-xl border-border text-foreground hover:border-purple' })}
            >
              Explore Market
            </Link>
          </div>
        </PageContainer>
      </div>
    </>
  )
}
