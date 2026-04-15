'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Input, Textarea } from '@/components/ui/input'
import { buttonStyles } from '@/components/ui/button'
import { UploadZone } from '@/components/ui/upload-zone'
import { useCreateSoul } from '@/components/providers/create-soul-provider'

const royaltyOptions = [
  { value: 0, label: 'Off', desc: '0%' },
  { value: 250, label: 'Low', desc: '2.5%' },
  { value: 500, label: 'Standard', desc: '5%', recommended: true },
  { value: 1000, label: 'High', desc: '10%' },
] as const

function FieldLabel({
  label,
  required = false,
  optional = false,
  error,
}: {
  label: string
  required?: boolean
  optional?: boolean
  error?: string | null
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="page-kicker text-muted">{label}</span>
      {required ? <span className="text-xs font-semibold text-danger">*</span> : null}
      {optional ? <span className="text-[11px] font-medium text-muted/80">(optional)</span> : null}
      {error ? <span className="text-[11px] font-medium text-danger">{error}</span> : null}
    </div>
  )
}

export default function CreateSoulPage() {
  const router = useRouter()
  const ctx = useCreateSoul()
  const [errors, setErrors] = useState<Record<string, string>>({})

  function handleNext() {
    const nextErrors: Record<string, string> = {}
    if (!ctx.name.trim()) nextErrors.name = 'Required'
    if (!ctx.description.trim()) nextErrors.description = 'Required'
    if (!ctx.coverImageFile) nextErrors.coverImageFile = 'Required'
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    router.push('/create/content')
  }

  return (
    <div className="relative z-10 border-t border-purple/20">
      <PageContainer size="sm" className="space-y-6 pt-7 sm:pt-9">
        <SectionHeader
          label="Create Soul"
          title="Step 1 — Basic Info"
          className="mb-2"
        />

        <div className="space-y-5">
          <div className="space-y-2">
            <FieldLabel label="Soul Name" required error={errors.name} />
            <Input
              placeholder="e.g. AlphaScout, Kaze no Akira..."
              value={ctx.name}
              onChange={(e) => ctx.setName(e.target.value)}
              className="h-11 rounded-xl border-purple/35 bg-card2/90 px-4 placeholder:text-[#5f4f90] focus:border-purple"
            />
          </div>

          <div className="space-y-2">
            <FieldLabel label="Description" required error={errors.description} />
            <Textarea
              placeholder="Describe your Soul — what it does, who it's for, what makes it unique..."
              value={ctx.description}
              onChange={(e) => ctx.setDescription(e.target.value)}
              className="min-h-[104px] resize-none rounded-xl border-purple/35 bg-card2/90 px-4 py-3 placeholder:text-[#5f4f90] focus:border-purple"
            />
          </div>

          <div className="space-y-2">
            <FieldLabel label="Tags (comma-separated)" />
            <Input
              placeholder="e.g. ai, trading, signals"
              value={ctx.tags}
              onChange={(e) => ctx.setTags(e.target.value)}
              className="h-11 rounded-xl border-purple/35 bg-card2/90 px-4 placeholder:text-[#5f4f90] focus:border-purple"
            />
          </div>

          <div className="space-y-2">
            <FieldLabel label="Preview Image" required error={errors.coverImageFile} />
            {!ctx.coverImageFile ? (
              <UploadZone
                icon="🖼️"
                label="Click to upload cover image"
                sublabel="JPEG, PNG, WebP, GIF · max 10MB"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onFileSelect={(file) => ctx.setCoverImage(file)}
                className="rounded-[20px] border-purple/40 bg-[rgba(20,11,44,0.72)] px-6 py-10 text-center hover:border-purple hover:bg-purple/6"
              />
            ) : (
              <div className="card flex items-center gap-4 border-purple/30 bg-card2/75 px-4 py-4">
                {ctx.coverImagePreviewUrl && (
                  <img
                    src={ctx.coverImagePreviewUrl}
                    alt="Cover preview"
                    className="h-14 w-14 shrink-0 rounded-xl border border-purple/25 object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">{ctx.coverImageFile.name}</div>
                  <div className="text-xs text-muted">
                    {(ctx.coverImageFile.size / 1024).toFixed(1)} KB · local preview ready
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => ctx.setCoverImage(null)}
                  className="shrink-0 rounded-lg border border-purple/25 px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-purple/45 hover:text-foreground"
                >
                  Replace
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <FieldLabel label="Creator Royalty" optional />
            <div className="grid grid-cols-4 gap-2.5">
              {royaltyOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => ctx.setRoyalty(opt.value)}
                  className={`relative flex min-h-[72px] min-w-0 flex-col items-center justify-center rounded-2xl border px-2 pb-3 pt-3 text-center transition ${
                    ctx.royalty === opt.value
                      ? 'border-purple bg-purple/12 shadow-[0_10px_24px_rgba(124,58,237,0.18)]'
                      : 'border-border bg-card2/40 hover:border-purple/40 hover:bg-purple/6'
                  }`}
                >
                  {'recommended' in opt && opt.recommended ? (
                    <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal px-2 py-0.5 text-[10px] font-semibold text-[#081615] shadow-[0_8px_20px_rgba(20,184,166,0.28)]">
                      Recommended
                    </span>
                  ) : null}
                  <div className="font-display text-[13px] font-bold tracking-[-0.02em] text-foreground">
                    {opt.label}
                  </div>
                  <div className="mt-1 text-[11px] leading-4 text-muted">{opt.desc}</div>
                </button>
              ))}
            </div>
            <p className="text-xs leading-5 text-muted">
              Locked at mint. Automatically paid to your wallet on every secondary sale.
            </p>
          </div>
        </div>

        <div className="card flex items-start gap-3 rounded-2xl border-purple/20 bg-card2/55 px-4 py-4">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple/15 text-purple"
          >
            <svg width="12" height="14" viewBox="0 0 12 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3.25 5.5V4.25C3.25 2.73122 4.48122 1.5 6 1.5C7.51878 1.5 8.75 2.73122 8.75 4.25V5.5M2.83333 5.5H9.16667C9.99509 5.5 10.6667 6.17157 10.6667 7V10.6667C10.6667 11.4951 9.99509 12.1667 9.16667 12.1667H2.83333C2.00491 12.1667 1.33333 11.4951 1.33333 10.6667V7C1.33333 6.17157 2.00491 5.5 2.83333 5.5Z" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p className="text-sm leading-6 text-muted">
            <span className="font-medium text-foreground">Basic Info is locked on-chain after minting</span>
            {' '}— name, description, cover image and royalty rate cannot be changed.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/market"
            className={buttonStyles({
              variant: 'outline',
              size: 'lg',
              className: 'w-[112px] rounded-xl border-border bg-transparent text-foreground hover:border-purple hover:text-foreground',
            })}
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={handleNext}
            className={buttonStyles({
              variant: 'landing',
              size: 'lg',
              className: 'min-w-0 flex-1 rounded-xl',
            })}
          >
            Next: Living Content <span aria-hidden="true">→</span>
          </button>
        </div>
      </PageContainer>
    </div>
  )
}
