'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { useImportSoul } from '@/components/providers/import-soul-provider'

const steps = [
  { label: 'Choose Source' },
  { label: 'Upload File' },
  { label: 'Map Fields' },
  { label: 'Soul Awakened' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

const royaltyLabels: Record<number, string> = {
  0: 'Off \u00b7 0%',
  250: 'Low \u00b7 2.5%',
  500: 'Standard \u00b7 5%',
  1000: 'High \u00b7 10%',
}

type ReviewTone = 'gold' | 'teal' | 'green' | 'orange' | 'muted' | 'purple'

const toneStyles: Record<ReviewTone, { border: string; header: string }> = {
  gold: { border: 'border-[#7b5a1e]', header: 'text-[#F59E0B]' },
  teal: { border: 'border-[#165c65]', header: 'text-teal' },
  green: { border: 'border-[#1b6040]', header: 'text-success' },
  orange: { border: 'border-[#7b4a1e]', header: 'text-[#F97316]' },
  purple: { border: 'border-purple/30', header: 'text-purple' },
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

function truncateHash(hash: string, len = 12) {
  if (hash.length <= len) return hash
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`
}

export default function ImportPreviewPage() {
  const router = useRouter()
  const ctx = useImportSoul()

  const missing = !ctx.resolvedName || !ctx.resolvedDescription || !ctx.coverImageFile || !ctx.charFile || !ctx.memoryFile
  useEffect(() => {
    if (missing) router.replace('/import/map')
  }, [missing, router])

  if (missing) return null

  return (
    <div className="relative z-10 border-t border-purple/20">
      <FlowBar steps={steps} currentStep={3} />

      <PageContainer size="md" className="space-y-5 pt-7 sm:pt-9">
        <SectionHeader
          label="Import Soul"
          title="✦ Soul Awakened"
          subtitle="Your imported Soul is assembled. Review what will live on-chain before minting."
          className="mb-1"
        />

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {/* Basic Info */}
          <ReviewCard tone="gold" icon="🔒" label="Basic Info">
            <div>
              <h3 className="text-[15px] font-bold text-foreground">{ctx.resolvedName}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {ctx.resolvedDescription.length > 120
                  ? `${ctx.resolvedDescription.slice(0, 120)}…`
                  : ctx.resolvedDescription}
              </p>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Creator Royalty</span>
              <span className="font-semibold text-[#F59E0B]">
                {royaltyLabels[ctx.royalty] ?? `${ctx.royalty / 100}%`}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Category</span>
              <span className="font-medium text-foreground">{ctx.category}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[#c89a4a]">
              <span>🔒</span>
              <span>Locked after mint</span>
            </div>
          </ReviewCard>

          {/* Import Source */}
          <ReviewCard tone="purple" icon="📥" label="Import Source">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{ctx.rawFile?.name ?? 'Unknown'}</span>
              <span className="rounded-full border border-purple/30 bg-purple/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-purple">
                Imported
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Origin Ref</span>
              <span className="font-mono text-[10px] text-teal">{truncateHash(ctx.originRef)}</span>
            </div>
            {ctx.parseStats && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Parsing Score</span>
                <span className="font-semibold text-success">{ctx.parseStats.parsingScore}%</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[10px] text-purple/80">
              <span>📦</span>
              <span>Provenance: imported · tracked on-chain</span>
            </div>
          </ReviewCard>

          {/* Soul Character */}
          <ReviewCard tone="teal" icon="📄" label="Soul Character">
            <p className="text-sm font-medium text-foreground">
              {ctx.charFile!.name}
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

          {/* Memory */}
          <ReviewCard tone="green" icon="🌱" label="Memory">
            <p className="text-sm font-medium text-foreground">
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
        </div>

        {/* Skills & Docs (if uploaded) */}
        {ctx.skillsFile && (
          <ReviewCard tone="orange" icon="🧠" label="Skills & Docs">
            <p className="text-sm font-medium text-foreground">
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
          </ReviewCard>
        )}

        {/* Content & Memory Policy */}
        <div className="rounded-2xl border border-purple/30 bg-purple/6 p-5">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-purple">
            Content & Memory Policy
          </div>
          <p className="mb-4 text-xs leading-relaxed text-muted">
            Imported provenance stays visible, while the new Soul content follows the same sealed character, encrypted founding memory, and private-by-default skills model as native minting. Live memory grows later through grant-authorized writes on Walrus.
          </p>
          <div className="space-y-2.5">
            {[
              { allowed: true, title: 'Imported provenance stays visible', desc: 'origin ref and import status remain attached to the minted Soul' },
              { allowed: true, title: 'Character locked after mint', desc: 'the selected soul.md becomes the canonical identity layer for this Soul' },
              { allowed: true, title: 'Grant-gated write', desc: 'only the owner or an active grant can add live memory or manage private skill bundles' },
              { allowed: true, title: 'Revocable access', desc: 'revoke a grant anytime; Seal approvals stop resolving immediately' },
              { allowed: true, title: 'History stays intact', desc: 'founding memory remains preserved while later sessions add new entries instead of replacing it' },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-2">
                <span className={cn('mt-0.5 shrink-0', item.allowed ? 'text-success' : 'text-danger')}>
                  {item.allowed ? '✓' : '✗'}
                </span>
                <p className="text-xs leading-relaxed text-muted">
                  <span className="font-semibold text-foreground">{item.title}</span> — {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
          <Link
            href="/import/map"
            className={buttonStyles({
              variant: 'outline',
              size: 'lg',
              className: 'w-full rounded-[10px] border-purple/20 bg-transparent px-4 py-2.5 text-[13px] text-foreground hover:border-purple/45 hover:text-foreground sm:w-auto sm:min-w-[76px]',
            })}
          >
            ← Back
          </Link>
          <Link
            href="/import/gas"
            className={buttonStyles({
              variant: 'landing',
              size: 'lg',
              full: true,
              className: 'rounded-[10px] px-4 py-2.5 text-[13px] shadow-[0_14px_34px_rgba(124,58,237,0.34)]',
            })}
          >
            Next: Pay Gas <span aria-hidden="true">→</span>
          </Link>
        </div>
      </PageContainer>
    </div>
  )
}
