'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { buttonStyles } from '@/components/ui/button'
import { useCreateCollection, collectionSteps } from '@/components/providers/create-collection-provider'

function formatRoyalty(bps: number) {
  const pct = bps / 100
  return pct % 1 === 0 ? `${pct}%` : `${pct.toFixed(1)}%`
}

function formatAddress(value: string) {
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function ConfirmRow({
  label,
  value,
  color,
  bold,
}: {
  label: string
  value: string
  color?: 'teal' | 'gold'
  bold?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[13px] text-muted">{label}</span>
      <span
        className={`text-right text-[13px] ${
          color === 'teal'
            ? 'text-teal'
            : color === 'gold'
              ? 'text-gold'
              : bold
                ? 'font-semibold text-foreground'
                : 'text-foreground'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

export default function LaunchedPage() {
  const router = useRouter()
  const ctx = useCreateCollection()
  const result = ctx.publishResult

  useEffect(() => {
    if (ctx.isHydrated && !ctx.publishResult) {
      router.replace('/collections/create')
    }
  }, [ctx.isHydrated, ctx.publishResult, router])

  if (!result) {
    return null
  }

  const snapshot = ctx.successSnapshot
  const floor = snapshot?.floorPrice ?? (ctx.floorPrice || '0')
  const royaltyDisplay = formatRoyalty(snapshot?.extraRoyaltyBps ?? ctx.extraRoyaltyBps)
  const soulNamesArr = snapshot?.soulNames ?? ctx.batchSouls.map((s) => s.name)
  const soulNames = soulNamesArr.join(' & ')
  const collectionName = snapshot?.name || ctx.name || 'Collection'
  const tradeable = snapshot?.tradeable ?? ctx.tradeable
  const soulCount = soulNamesArr.length
  const collectionId = result.collectionOnChainId
  const maxSoulSupply = snapshot?.maxSoulSupply ?? result.maxSoulSupply ?? null
  const isEmpty = soulCount === 0
  const capacityLabel = maxSoulSupply == null ? 'Unlimited' : maxSoulSupply

  return (
    <>
      <FlowBar steps={collectionSteps} currentStep={3} />

      <div className="relative z-10 border-t border-purple/20">
        <PageContainer size="sm" className="space-y-6 py-10 text-center sm:py-14">
          {/* Sparkle icon */}
          <div className="mx-auto text-5xl leading-none" aria-hidden="true">
            ✦
          </div>

          {/* Title */}
          <div>
            <p className="page-kicker mb-2 text-purple">Soul Collection</p>
            <h2 className="page-title mb-3">Collection Born</h2>
            <p className="page-copy mx-auto max-w-md">
              {isEmpty
                ? 'Collection created. Add Souls when ready.'
                : 'Your collection is live on Sui. Souls are minted and bound — ready for the market.'}
            </p>
          </div>

          {/* On-chain confirmation */}
          <div className="rounded-2xl border border-border bg-card2/55 p-5 text-left">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
              On-Chain Confirmation
            </p>
            <div className="space-y-3">
              <ConfirmRow
                label="Soul Collection"
                value={`${collectionName.toUpperCase()} · ${formatAddress(collectionId)}`}
                bold
              />
              <ConfirmRow
                label="Souls minted"
                value={
                  isEmpty
                    ? `0 now · capacity ${capacityLabel}`
                    : `${soulCount}${maxSoulSupply == null ? '' : ' / ' + maxSoulSupply} · ${soulNames}`
                }
                bold
              />
              <ConfirmRow
                label="Soul floor price"
                value={`${floor} USDC`}
                bold
              />
              <ConfirmRow
                label="Soul Collection"
                value={tradeable ? 'Tradeable · Not listed yet' : 'Non-tradeable'}
                color="teal"
              />
              <ConfirmRow
                label="Creator royalty"
                value={`${royaltyDisplay} · enforced on-chain`}
                color="teal"
              />
              <ConfirmRow
                label="Status"
                value="✓ Live on Sui"
                color="teal"
              />
              {result.txDigest && (
                <ConfirmRow
                  label="TX Digest"
                  value={formatAddress(result.txDigest)}
                  color="teal"
                />
              )}
            </div>
          </div>

          {/* List CTA */}
          {tradeable && (
            <div className="rounded-2xl border border-gold/25 bg-gold/5 px-5 py-5 text-center">
              <p className="text-sm font-bold text-foreground">
                🏷 List your Soul Collection for sale
              </p>
              <p className="mt-1 text-[13px] text-muted">
                Sell the royalty rights to a buyer. You set the price — listing takes ~1 min.
              </p>
              <Link
                href="/my-souls"
                className={buttonStyles({
                  variant: 'outline',
                  size: 'sm',
                  className: 'mt-3 rounded-lg border-gold/40 text-gold hover:border-gold hover:text-gold',
                })}
              >
                List Now →
              </Link>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-3">
            <Link
              href={`/collections/${encodeURIComponent(result.collectionOnChainId)}`}
              className={buttonStyles({
                variant: 'landing',
                size: 'lg',
                className: 'rounded-xl',
              })}
            >
              View Collection →
            </Link>
            <Link
              href="/my-souls"
              className={buttonStyles({
                variant: 'outline',
                size: 'lg',
                className: 'rounded-xl',
              })}
            >
              My Collections
            </Link>
          </div>
        </PageContainer>
      </div>
    </>
  )
}
