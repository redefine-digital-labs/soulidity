'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { useCreateSoul } from '@/components/providers/create-soul-provider'
import { formatAtomicAmountForDisplay, parseDisplayAmountToAtomic } from '@soulidity/sdk'

function atomicToPriceInput(atomic: string | null): string {
  if (!atomic) return ''
  try {
    return formatAtomicAmountForDisplay(atomic, { symbol: '' }).trim()
  } catch {
    return ''
  }
}

const steps = [
  { label: 'Basic Info' },
  { label: 'Living Content' },
  { label: 'Preview & Confirm' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

const royaltyLabels: Record<number, string> = {
  0: 'Off · 0%',
  250: 'Low · 2.5%',
  500: 'Standard · 5%',
  1000: 'High · 10%',
}

type ReviewTone = 'gold' | 'teal' | 'green' | 'orange' | 'purple' | 'muted'

const toneStyles: Record<ReviewTone, { border: string; header: string }> = {
  gold: { border: 'border-[var(--ui-value)]', header: 'text-[var(--ui-value-text)]' },
  teal: { border: 'border-[var(--ui-tech)]', header: 'text-[var(--ui-tech-text)]' },
  green: { border: 'border-[var(--ui-success)]', header: 'text-success' },
  orange: { border: 'border-[var(--ui-warning)]', header: 'text-[var(--ui-value-text)]' },
  purple: { border: 'border-purple/30', header: 'text-action-label' },
  muted: { border: 'border-border', header: 'text-muted' },
}

function ReviewCard({
  tone,
  icon,
  label,
  children,
  className,
}: {
  tone: ReviewTone
  icon: string
  label: string
  children: React.ReactNode
  className?: string
}) {
  const styles = toneStyles[tone]
  return (
    <div className={cn('rounded-2xl border bg-card p-4', styles.border, className)}>
      <div className={cn('text-[11px] font-bold uppercase tracking-[0.08em] mb-2.5', styles.header)}>
        {icon} {label}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function PolicyItem({
  allowed,
  title,
  description,
}: {
  allowed: boolean
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-2">
      <span className={cn('mt-0.5 shrink-0', allowed ? 'text-success' : 'text-danger')}>
        {allowed ? '✓' : '✗'}
      </span>
      <p className="text-xs leading-relaxed text-muted">
        <span className="font-semibold text-foreground">{title}</span> — {description}
      </p>
    </div>
  )
}

export default function CreatePreviewPage() {
  const router = useRouter()
  const ctx = useCreateSoul()

  // Listing price input is decimal USDC (e.g. "1.000001" → 1_000_001 atomic).
  // We keep the raw typed string locally so partial values like "1." don't get
  // reformatted mid-typing, and mirror the parsed atomic value into ctx so the
  // gas page and use-publish keep their atomic-string contract.
  const [priceInput, setPriceInput] = useState<string>(() => atomicToPriceInput(ctx.listingPriceAtomic))
  const [priceParseError, setPriceParseError] = useState<string | null>(null)

  const handlePriceChange = (raw: string) => {
    setPriceInput(raw)
    const trimmed = raw.trim()
    if (!trimmed) {
      setPriceParseError(null)
      ctx.setListingPriceAtomic(null)
      return
    }
    try {
      const atomic = parseDisplayAmountToAtomic(trimmed)
      if (atomic <= 0n) {
        setPriceParseError('Listing price must be greater than 0')
        ctx.setListingPriceAtomic(null)
        return
      }
      setPriceParseError(null)
      ctx.setListingPriceAtomic(atomic.toString())
    } catch (err) {
      setPriceParseError(err instanceof Error ? err.message : 'Invalid amount')
      ctx.setListingPriceAtomic(null)
    }
  }

  // Guard: redirect to earliest incomplete step when required data is missing
  const missingStep1 = !ctx.name || !ctx.description || !ctx.coverImageFile
  const missingStep2 = !ctx.charFile || !ctx.memoryFile
  useEffect(() => {
    if (missingStep1) {
      router.replace('/create')
    } else if (missingStep2) {
      router.replace('/create/content')
    }
  }, [missingStep1, missingStep2, router])

  if (!ctx.name || !ctx.description || !ctx.coverImageFile || !ctx.charFile || !ctx.memoryFile) return null

  // Validate the list-on-publish price BEFORE allowing navigation to /create/gas.
  // Without this, the user could enable "List immediately" with an empty / non-numeric
  // / zero price, click through, sign the paid Walrus register PTB on the gas page,
  // and only then have `usePublish.assertListingPriceAtomic` reject the value —
  // leaving paid registered blobs orphaned for a preventable form error.
  let listingPriceError: string | null = null
  if (ctx.listOnPublish) {
    if (priceParseError) {
      listingPriceError = priceParseError
    } else if (!priceInput.trim()) {
      listingPriceError = 'Listing price is required'
    } else if (ctx.listingPriceAtomic == null) {
      listingPriceError = 'Listing price is invalid'
    }
  }
  const listingPriceBlocked = ctx.listOnPublish && listingPriceError !== null

  return (
    <div className="relative z-10 border-t border-purple/20">
      <FlowBar steps={steps} currentStep={2} />

      <PageContainer size="md" className="space-y-5 pt-7 sm:pt-9">
        <SectionHeader
          label="Create Soul"
          title="✦ Ready to Mint"
          subtitle="Your Soul is assembled. Review what will live on-chain — then sign to awaken it."
          className="mb-1"
        />

        {/* 2×2 review grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <ReviewCard tone="gold" icon="🔒" label="Basic Info">
            <div>
              <h3 className="text-[15px] font-bold text-foreground">{ctx.name}</h3>
              <p className="text-xs text-muted leading-relaxed mt-1">
                {ctx.description.length > 120
                  ? `${ctx.description.slice(0, 120)}…`
                  : ctx.description}
              </p>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Creator Royalty</span>
              <span className="font-semibold text-[var(--ui-value-text)]">
                {royaltyLabels[ctx.royalty] ?? `${ctx.royalty / 100}%`}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--ui-value-text)]">
              <span>🔒</span>
              <span>Locked after mint</span>
            </div>
          </ReviewCard>

          <ReviewCard tone="teal" icon="📄" label="Soul Character">
            <p className="text-sm text-foreground font-medium">
              {ctx.charFile.name}
            </p>
            <div className="flex items-center gap-1.5 text-[10px] text-success">
              <span>✍</span>
              <span>Prepared for encrypted upload</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted">
              <span>🔒</span>
              <span>Locks after mint · standard soul.md</span>
            </div>
          </ReviewCard>

          <ReviewCard tone="green" icon="🌱" label="Memory">
            <p className="text-sm text-foreground font-medium">
              {ctx.memoryFile!.name} · founding memory
            </p>
            <div className="flex items-center gap-1.5 text-[10px] text-success">
              <span>✍</span>
              <span>Prepared as the first memory entry</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted">
              <span>🔒</span>
              <span>Encrypted at mint · preserved after mint</span>
            </div>
          </ReviewCard>

          <ReviewCard tone="orange" icon="🧠" label="Skills & Docs">
            {ctx.skillsFile ? (
              <>
                <p className="text-sm text-foreground font-medium">
                  {ctx.skillsFile.name}
                </p>
                <div className="flex items-center gap-1.5 text-[10px] text-success">
                  <span>✍</span>
                  <span>Private by default</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted">
                  <span>🔐</span>
                  <span>Additional revisions can be added later</span>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-muted leading-relaxed">
                  Not provided — you can add Skills & Docs after minting.
                </p>
                <div className="flex items-center gap-1.5 text-[10px] text-muted">
                  <span>⊘</span>
                  <span>Can be added anytime post-mint</span>
                </div>
              </>
            )}
          </ReviewCard>

        </div>

        {/* Live Memory — full width */}
        <ReviewCard tone="muted" icon="💾" label="Live Memory">
          <p className="text-xs text-muted leading-relaxed">
            Starts empty at mint. SoulGrant-authorized sessions can add encrypted memory entries on Walrus as this Soul accumulates history.
          </p>
          <div className="flex items-center gap-1.5 text-[10px] text-muted">
            <span>⊘</span>
            <span>Add-only history · grant-gated writes</span>
          </div>
        </ReviewCard>

        {/* Content & Memory Policy */}
        <div className="rounded-2xl border border-purple/30 bg-purple/6 p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-action-label mb-3">
            Content & Memory Policy
          </div>
          <p className="text-xs text-muted leading-relaxed mb-4">
            Soul Character is sealed and locked at mint. Founding memory becomes the first encrypted memory entry. Skills bundles stay private by default, persona sprites are added after mint from the Soul detail page, and live memory grows through grant-authorized writes on Walrus.
          </p>
          <div className="space-y-2.5">
            <PolicyItem
              allowed
              title="Character locked after mint"
              description="the selected soul.md becomes the canonical identity layer for this Soul"
            />
            <PolicyItem
              allowed
              title="Grant-gated write"
              description="only the owner or an active grant can add live memory or manage private skill bundles"
            />
            <PolicyItem
              allowed
              title="Revocable access"
              description="revoke a grant anytime; Seal approvals stop resolving immediately"
            />
            <PolicyItem
              allowed
              title="History stays intact"
              description="founding memory remains preserved while later sessions add new entries instead of replacing it"
            />
          </div>
        </div>

        {/* Marketplace settings (listing/bind) — applied in the same PTB as mint */}
        <div className="rounded-2xl border border-purple/30 bg-purple/6 p-5 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-action-label">
            Marketplace settings
          </div>
          <p className="text-xs text-muted leading-relaxed">
            Listing and collection binding are applied in the same on-chain transaction as the mint, so it costs no extra wallet signatures.
          </p>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={ctx.listOnPublish}
              onChange={(e) => ctx.setListOnPublish(e.currentTarget.checked)}
              className="h-4 w-4 accent-purple"
            />
            List immediately on the marketplace
          </label>
          {ctx.listOnPublish && (
            <div className="space-y-1 pl-6">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">Price (USDC)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={priceInput}
                  onChange={(e) => handlePriceChange(e.currentTarget.value)}
                  placeholder="e.g. 1.5"
                  aria-invalid={listingPriceError ? 'true' : 'false'}
                  data-testid="listing-price-input"
                  className={cn(
                    'rounded border bg-transparent px-2 py-1 text-xs text-foreground',
                    listingPriceError ? 'border-danger/60' : 'border-purple/30',
                  )}
                />
              </div>
              {listingPriceError && (
                <p className="text-[11px] text-danger" data-testid="listing-price-error">
                  {listingPriceError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
          <Link
            href="/create/content"
            className={buttonStyles({
              variant: 'outline',
              size: 'lg',
              className:
                'w-full rounded-[10px] border-purple/20 bg-transparent px-4 py-2.5 text-[13px] text-foreground hover:border-purple/45 hover:text-foreground sm:w-auto sm:min-w-[76px]',
            })}
          >
            ← Back
          </Link>
          {listingPriceBlocked ? (
            <button
              type="button"
              disabled
              aria-disabled="true"
              data-testid="next-pay-gas-disabled"
              title={listingPriceError ?? 'Fix the listing price to continue'}
              className={buttonStyles({
                variant: 'landing',
                size: 'lg',
                full: true,
                className:
                  'rounded-[10px] px-4 py-2.5 text-[13px] opacity-50 cursor-not-allowed shadow-none',
              })}
            >
              Next: Pay Gas <span aria-hidden="true">→</span>
            </button>
          ) : (
            <Link
              href="/create/gas"
              data-testid="next-pay-gas"
              className={buttonStyles({
                variant: 'landing',
                size: 'lg',
                full: true,
                className:
                  'rounded-[10px] px-4 py-2.5 text-[13px] shadow-[var(--ui-shadow-action)]',
              })}
            >
              Next: Pay Gas <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      </PageContainer>
    </div>
  )
}
