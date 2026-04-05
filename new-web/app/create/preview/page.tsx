'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { useCreateSoul } from '@/components/providers/create-soul-provider'

const steps = [
  { label: 'Basic Info' },
  { label: 'Living Content' },
  { label: 'Soul Awakened' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

const royaltyLabels: Record<number, string> = {
  0: 'Off · 0%',
  250: 'Low · 2.5%',
  500: 'Standard · 5%',
  1000: 'High · 10%',
}

type ReviewTone = 'gold' | 'teal' | 'green' | 'orange' | 'muted'

const toneStyles: Record<ReviewTone, { border: string; header: string }> = {
  gold: { border: 'border-[#7b5a1e]', header: 'text-[#F59E0B]' },
  teal: { border: 'border-[#165c65]', header: 'text-teal' },
  green: { border: 'border-[#1b6040]', header: 'text-success' },
  orange: { border: 'border-[#7b4a1e]', header: 'text-[#F97316]' },
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

  // Guard: redirect to earliest incomplete step when required data is missing
  const missingStep1 = !ctx.name || !ctx.description || !ctx.coverImageFile
  const missingStep2 = !ctx.charFile || !ctx.memorySeed.trim()
  useEffect(() => {
    if (missingStep1) {
      router.replace('/create')
    } else if (missingStep2) {
      router.replace('/create/content')
    }
  }, [missingStep1, missingStep2, router])

  if (!ctx.name || !ctx.description || !ctx.coverImageFile || !ctx.charFile || !ctx.memorySeed.trim()) return null

  return (
    <div className="relative z-10 border-t border-purple/20">
      <FlowBar steps={steps} currentStep={2} />

      <PageContainer size="md" className="space-y-5 pt-7 sm:pt-9">
        <SectionHeader
          label="Create Soul"
          title="✦ Soul Awakened"
          subtitle="Your Soul is assembled. Review what will live on-chain before minting."
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
              <span className="text-[#F59E0B] font-semibold">
                {royaltyLabels[ctx.royalty] ?? `${ctx.royalty / 100}%`}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Category</span>
              <span className="text-foreground font-medium">{ctx.category}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[#c89a4a]">
              <span>🔒</span>
              <span>Locked after mint</span>
            </div>
          </ReviewCard>

          <ReviewCard tone="teal" icon="📄" label="Soul Character">
            <p className="text-sm text-foreground font-medium">
              {ctx.charFile.name} · v1 · main
            </p>
            <div className="flex items-center gap-1.5 text-[10px] text-success">
              <span>✍</span>
              <span>Git versioned · main active</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted">
              <span>⊘</span>
              <span>Append-only · no delete</span>
            </div>
          </ReviewCard>

          <ReviewCard tone="green" icon="🌱" label="Memory Seed">
            <p className="text-xs text-muted leading-relaxed">
              {ctx.memorySeed.length > 150
                ? `${ctx.memorySeed.slice(0, 150)}…`
                : ctx.memorySeed}
            </p>
            <div className="flex items-center gap-1.5 text-[10px] text-success">
              <span>✍</span>
              <span>{ctx.memorySeed.length} characters · founding memory</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted">
              <span>🔒</span>
              <span>Immutable after mint · no delete</span>
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
                  <span>Git versioned · main active</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted">
                  <span>⊘</span>
                  <span>Update anytime · no delete</span>
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
            Empty at mint. Grows through SoulGrant interactions on Walrus — each session
            appends a new commit.
          </p>
          <div className="flex items-center gap-1.5 text-[10px] text-muted">
            <span>⊘</span>
            <span>Append-only · no edits · no deletes · SoulGrant writes here</span>
          </div>
        </ReviewCard>

        {/* Content & Memory Policy */}
        <div className="rounded-2xl border border-purple/30 bg-purple/6 p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-purple mb-3">
            Content & Memory Policy
          </div>
          <p className="text-xs text-muted leading-relaxed mb-4">
            All three content layers are git-versioned and append-only. SoulGrant agents always read from{' '}
            <span className="font-bold text-foreground">main</span>. Live Memory grows through SoulGrant
            interactions on Walrus and cannot be edited or deleted by anyone, including you.
          </p>
          <div className="space-y-2.5">
            <PolicyItem
              allowed
              title="SoulGrant reads main"
              description="agents always use latest commit on main; full version history preserved & auditable"
            />
            <PolicyItem
              allowed
              title="Grant-gated write"
              description="only authorized agents can append to Live Memory or update Skills & Docs"
            />
            <PolicyItem
              allowed
              title="Revocable access"
              description="revoke grant anytime; memory stays on Walrus, writes stop immediately"
            />
            <PolicyItem
              allowed={false}
              title="No delete — ever"
              description="Soul Character, Memory Seed, Skills & Docs, Live Memory: all append-only, no delete"
            />
            <PolicyItem
              allowed={false}
              title="No fork"
              description="this Soul cannot be duplicated or branched by others"
            />
          </div>
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
          <Link
            href="/create/gas"
            className={buttonStyles({
              variant: 'landing',
              size: 'lg',
              full: true,
              className:
                'rounded-[10px] px-4 py-2.5 text-[13px] shadow-[0_14px_34px_rgba(124,58,237,0.34)]',
            })}
          >
            Next: Pay Gas <span aria-hidden="true">→</span>
          </Link>
        </div>
      </PageContainer>
    </div>
  )
}
