'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'
import { SkillBundleFormatHint } from '@/components/souls/skill-bundle-format-hint'
import { cn } from '@/lib/utils/cn'
import { useCreateSoul } from '@/components/providers/create-soul-provider'
import { SOUL_MD_TEMPLATE } from '@/lib/soulidity/content-templates'
import { validateSelectedSkillBundle } from '@/lib/soulidity/upload-validation'

const steps = [
  { label: 'Basic Info' },
  { label: 'Living Content' },
  { label: 'Preview & Confirm' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

type CardTone = 'amber' | 'violet' | 'teal'

const toneStyles: Record<
  CardTone,
  {
    card: string
    meta: string
    badge: string
    upload: string
    uploadIcon: string
    uploadSubtitle: string
    success: string
    successAccent: string
  }
> = {
  amber: {
    card:
      'border-[#7b5a1e] bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_36%),linear-gradient(180deg,rgba(31,18,58,0.97),rgba(18,10,37,0.98))]',
    meta: 'text-[#ddae5a]',
    badge: 'border-[#8a6326] bg-[rgba(107,69,18,0.52)] text-[#ffcb74]',
    upload:
      'border-[#8b6324] bg-[rgba(18,11,35,0.72)] hover:border-[#d89d42] hover:bg-[rgba(33,19,58,0.82)]',
    uploadIcon: 'text-[#ffe2b0]',
    uploadSubtitle: 'text-[#b79864]',
    success:
      'border-[#8a6326] bg-[linear-gradient(180deg,rgba(38,24,63,0.96),rgba(25,15,43,0.98))]',
    successAccent: 'text-[#f4c36c]',
  },
  violet: {
    card:
      'border-[#4f2d84] bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.16),transparent_38%),linear-gradient(180deg,rgba(28,17,63,0.97),rgba(18,10,41,0.98))]',
    meta: 'text-[#b889ff]',
    badge: 'border-[#633796] bg-[rgba(92,47,162,0.38)] text-[#d1b4ff]',
    upload:
      'border-[#613892] bg-[rgba(18,11,35,0.72)] hover:border-[#a966ff] hover:bg-[rgba(33,19,58,0.82)]',
    uploadIcon: 'text-[#d6bbff]',
    uploadSubtitle: 'text-[#9f7bdc]',
    success:
      'border-[#5f3794] bg-[linear-gradient(180deg,rgba(39,22,72,0.96),rgba(25,15,43,0.98))]',
    successAccent: 'text-[#cfb0ff]',
  },
  teal: {
    card:
      'border-[#165c65] bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.12),transparent_38%),linear-gradient(180deg,rgba(18,25,52,0.97),rgba(12,15,35,0.98))]',
    meta: 'text-[#58d3c7]',
    badge: 'border-[#1e666f] bg-[rgba(19,102,108,0.32)] text-[#8ceae0]',
    upload:
      'border-[#1b636d] bg-[rgba(14,18,40,0.76)] hover:border-[#42c9bd] hover:bg-[rgba(18,24,52,0.84)]',
    uploadIcon: 'text-[#9aece3]',
    uploadSubtitle: 'text-[#63c9bf]',
    success:
      'border-[#1d6f78] bg-[linear-gradient(180deg,rgba(10,56,61,0.96),rgba(9,34,38,0.98))]',
    successAccent: 'text-[#8ceae0]',
  },
}

function formatFileSize(file: File) {
  if (file.size >= 1024 * 1024) {
    return `${(file.size / (1024 * 1024)).toFixed(2)} MB`
  }

  return `${Math.max(file.size / 1024, 0.1).toFixed(1)} KB`
}

function downloadCharacterTemplate() {
  const blob = new Blob([SOUL_MD_TEMPLATE], {
    type: 'text/markdown;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = 'soul.md'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function LayerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M3.25 4.25h9.5M3.25 8h9.5M3.25 11.75h9.5M2.25 4.25a1 1 0 1 0 0 .01M2.25 8a1 1 0 1 0 0 .01M2.25 11.75a1 1 0 1 0 0 .01"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M5.25 2.75h6.25l4.25 4.25v9.25a1.5 1.5 0 0 1-1.5 1.5h-9a1.5 1.5 0 0 1-1.5-1.5v-12a1.5 1.5 0 0 1 1.5-1.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M11.5 2.75v4.25h4.25" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6.75 11.5h6.5M6.75 14.25h4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function SeedIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M9.75 17.25V11m0 0c0-2.75 1.9-5.25 5.5-5.5 0 3.95-2.3 5.5-5.5 5.5Zm0 0c0-2.5-1.3-4.65-4.75-5.25 0 3.55 1.95 5.25 4.75 5.25Z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PackageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 2.75 16 6v8L10 17.25 4 14V6l6-3.25Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path d="M4 6 10 9.25 16 6M10 9.25v8" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    </svg>
  )
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M8 2.5v6m0 0 2.25-2.25M8 8.5 5.75 6.25M3 10.75v1.25c0 .69.56 1.25 1.25 1.25h7.5c.69 0 1.25-.56 1.25-1.25v-1.25"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="m3.5 8.25 2.5 2.5L12.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M4.75 7V5.75a3.25 3.25 0 1 1 6.5 0V7m-7 0h7.5c.69 0 1.25.56 1.25 1.25v4c0 .69-.56 1.25-1.25 1.25h-7.5C3.56 13.5 3 12.94 3 12.25v-4C3 7.56 3.56 7 4.25 7Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function MetaLine({
  tone,
  children,
}: {
  tone: CardTone
  children: React.ReactNode
}) {
  return (
    <div className={cn('mt-1 flex items-center gap-1.5 text-[10px] font-medium tracking-[0.01em]', toneStyles[tone].meta)}>
      <LayerIcon className="h-3.5 w-3.5 shrink-0" />
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">{children}</div>
    </div>
  )
}

function RequirementBadge({
  tone,
  children,
}: {
  tone: CardTone
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-[1px] text-[9px] font-bold uppercase tracking-[0.08em]',
        toneStyles[tone].badge,
      )}
    >
      {children}
    </span>
  )
}

function ContentCard({
  tone,
  title,
  badge,
  icon,
  description,
  meta,
  children,
}: {
  tone: CardTone
  title: string
  badge: React.ReactNode
  icon: React.ReactNode
  description: string
  meta: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'rounded-[18px] border px-3.5 py-3.5 shadow-[0_16px_44px_rgba(6,2,17,0.32)] sm:px-4 sm:py-4',
        toneStyles[tone].card,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('shrink-0', toneStyles[tone].meta)}>{icon}</span>
            <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
            {badge}
          </div>
          <MetaLine tone={tone}>{meta}</MetaLine>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-5 text-muted">{description}</p>

      <div className="mt-3">{children}</div>
    </section>
  )
}

function UploadTarget({
  tone,
  icon,
  label,
  subtitle,
  accept,
  onSelect,
}: {
  tone: CardTone
  icon: React.ReactNode
  label: string
  subtitle: string
  accept?: string
  onSelect: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function openPicker() {
    inputRef.current?.click()
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0]
    if (nextFile) {
      onSelect(nextFile)
    }
    event.target.value = ''
  }

  function handleDrop(event: React.DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    const nextFile = event.dataTransfer.files?.[0]
    if (nextFile) {
      onSelect(nextFile)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="sr-only"
        tabIndex={-1}
      />

      <button
        type="button"
        onClick={openPicker}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        className={cn(
          'flex w-full flex-col items-center justify-center rounded-[14px] border border-dashed px-5 py-8 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/35',
          toneStyles[tone].upload,
        )}
      >
        <span className={cn('mb-3', toneStyles[tone].uploadIcon)}>{icon}</span>
        <span className="text-[13px] font-semibold text-foreground">{label}</span>
        <span className={cn('mt-1 text-[10px] font-medium', toneStyles[tone].uploadSubtitle)}>{subtitle}</span>
      </button>
    </>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function UploadStatus({
  tone,
  title,
  subtitle,
  onClear,
}: {
  tone: CardTone
  title: string
  subtitle: string
  onClear?: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-[14px] border px-3.5 py-3 sm:px-4',
        toneStyles[tone].success,
      )}
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/18 text-success">
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('text-[13px] font-semibold', toneStyles[tone].successAccent)}>{title}</div>
        <div className="mt-1 text-[10px] leading-4 text-muted">{subtitle}</div>
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted/60 transition-colors hover:bg-white/10 hover:text-foreground"
          aria-label="Remove file"
        >
          <CloseIcon className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

export default function CreateContentPage() {
  const router = useRouter()
  const ctx = useCreateSoul()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [skillBundleError, setSkillBundleError] = useState<string | null>(null)
  const [skillBundleName, setSkillBundleName] = useState<string | null>(null)

  async function handleSkillsFileSelect(file: File) {
    const result = await validateSelectedSkillBundle(file)
    if (!result.ok) {
      ctx.setSkillsFile(null)
      setSkillBundleName(null)
      setSkillBundleError(result.error)
      return
    }

    setSkillBundleError(null)
    setSkillBundleName(result.skillName)
    ctx.setSkillsFile(file)
  }

  function handleNext() {
    const nextErrors: Record<string, string> = {}
    if (!ctx.charFile) nextErrors.charFile = 'Soul Character file is required'
    if (!ctx.memoryFile) nextErrors.memoryFile = 'Memory file (memory.md) is required'
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    router.push('/create/preview')
  }

  return (
    <div className="relative z-10 border-t border-purple/20">
      <FlowBar steps={steps} currentStep={1} />

      <PageContainer size="sm" className="space-y-5 pt-7 sm:pt-9">
        <SectionHeader
          label="Create Soul"
          title="Step 2 - Living Content"
          subtitle="Three layers define your Soul. Character and founding memory are required before minting. Character locks at mint, memory starts encrypted, and skills stay private by default."
          className="mb-1"
        />

        <div className="space-y-3.5">
          <ContentCard
            tone="amber"
            title="Soul Character"
            badge={<RequirementBadge tone="amber">Required</RequirementBadge>}
            icon={<DocumentIcon className="h-4.5 w-4.5" />}
            meta={
              <>
                <span>Standard soul.md</span>
                <span className="opacity-45">•</span>
                <span>Seal encrypted</span>
                <span className="opacity-45">•</span>
                <span>locked after mint</span>
                <span className="opacity-45">•</span>
                <span>one per Soul</span>
              </>
            }
            description="The foundational identity file for this Soul - personality, backstory, traits, tone, and world-rules. Upload a markdown file using the standard soul.md structure. It is encrypted during upload and becomes the locked character layer once this Soul is minted."
          >
            {!ctx.charFile ? (
              <>
                <UploadTarget
                  tone="amber"
                  icon={<DocumentIcon className="h-8 w-8" />}
                  label="Click to upload soul.md"
                  subtitle=".md format only • use the shared soul.md template"
                  accept=".md,text/markdown"
                  onSelect={ctx.setCharFile}
                />
                {errors.charFile && (
                  <p className="mt-2 text-[11px] font-medium text-danger">{errors.charFile}</p>
                )}
                <button
                  type="button"
                  onClick={downloadCharacterTemplate}
                  className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#f1b85b] transition hover:text-[#ffd08a]"
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                  <span className="text-muted">Don&apos;t have one yet?</span>
                  <span>Download template</span>
                  <span aria-hidden="true">→</span>
                </button>
              </>
            ) : (
              <UploadStatus
                tone="amber"
                title={`${ctx.charFile.name} ready for encrypted upload`}
                subtitle={`Standard soul.md structure · locks after mint · ${formatFileSize(ctx.charFile)}`}
                onClear={() => ctx.setCharFile(null)}
              />
            )}
          </ContentCard>

          <ContentCard
            tone="violet"
            title="Memory"
            badge={<RequirementBadge tone="violet">Required</RequirementBadge>}
            icon={<SeedIcon className="h-4.5 w-4.5" />}
            meta={
              <>
                <span>Founding memory</span>
                <span className="opacity-45">•</span>
                <span>Seal encrypted</span>
                <span className="opacity-45">•</span>
                <span>locked after mint</span>
                <span className="opacity-45">•</span>
                <span>first memory entry</span>
              </>
            }
            description="The founding memory of this Soul - origin context, initial directives, or backstory. Upload a markdown file that becomes the first encrypted memory entry at mint. Later SoulGrant sessions can add new memory entries without replacing this seed."
          >
            {!ctx.memoryFile ? (
              <>
                <UploadTarget
                  tone="violet"
                  icon={<SeedIcon className="h-8 w-8" />}
                  label="Click to upload memory.md"
                  subtitle=".md format only • founding memory template"
                  accept=".md,text/markdown"
                  onSelect={ctx.setMemoryFile}
                />
                {errors.memoryFile && (
                  <p className="mt-2 text-[11px] font-medium text-danger">{errors.memoryFile}</p>
                )}
              </>
            ) : (
              <UploadStatus
                tone="violet"
                title={`${ctx.memoryFile.name} ready as founding memory`}
                subtitle={`Encrypted at mint · becomes the first memory entry · ${formatFileSize(ctx.memoryFile)}`}
                onClear={() => ctx.setMemoryFile(null)}
              />
            )}
          </ContentCard>

          <ContentCard
            tone="teal"
            title="Skills & Docs"
            badge={<RequirementBadge tone="teal">Optional</RequirementBadge>}
            icon={<PackageIcon className="h-4.5 w-4.5" />}
            meta={
              <>
                <span>ZIP bundle only</span>
                <span className="opacity-45">•</span>
                <span>private by default</span>
                <span className="opacity-45">•</span>
                <span>new revisions later</span>
                <span className="opacity-45">•</span>
                <span>grant-controlled access</span>
              </>
            }
            description="Upload knowledge docs, skill definitions, system prompts, and behavioral configs as a ZIP bundle with SKILL.md frontmatter. Private bundles are encrypted by default, and authorized writers can add new revisions later."
          >
            {!ctx.skillsFile ? (
              <>
                <UploadTarget
                  tone="teal"
                  icon={<PackageIcon className="h-8 w-8" />}
                  label="Click to upload bundle file"
                  subtitle=".zip only • encrypted via Seal"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  onSelect={(file) => {
                    void handleSkillsFileSelect(file)
                  }}
                />
                <SkillBundleFormatHint error={skillBundleError} className="mt-3" />
              </>
            ) : (
              <UploadStatus
                tone="teal"
                title="Skills & Docs bundle ready"
                subtitle={`Skill: ${skillBundleName ?? 'read from SKILL.md'} · ZIP bundle verified locally · ${formatFileSize(ctx.skillsFile)}`}
                onClear={() => {
                  ctx.setSkillsFile(null)
                  setSkillBundleName(null)
                  setSkillBundleError(null)
                }}
              />
            )}
          </ContentCard>
        </div>

        <div className="rounded-[12px] border border-purple/30 bg-purple/10 px-4 py-3">
          <div className="flex items-start gap-2.5 text-[11px] leading-5 text-[#b9a4df]">
            <LockIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#d4b5ff]" />
            <p>
              Mint creates one locked character layer, one encrypted founding memory entry, and an optional private skills bundle.
              Later SoulGrant sessions can add new memory entries or new skill revisions without rewriting the originals.
            </p>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
          <Link
            href="/create"
            className={buttonStyles({
              variant: 'outline',
              size: 'lg',
              className:
                'w-full rounded-[10px] border-purple/20 bg-transparent px-4 py-2.5 text-[13px] text-foreground hover:border-purple/45 hover:text-foreground sm:w-auto sm:min-w-[76px]',
            })}
          >
            ← Back
          </Link>
          <button
            type="button"
            onClick={handleNext}
            className={buttonStyles({
              variant: 'landing',
              size: 'lg',
              full: true,
              className:
                'rounded-[10px] px-4 py-2.5 text-[13px] shadow-[0_14px_34px_rgba(124,58,237,0.34)]',
            })}
          >
            Next: Preview <span aria-hidden="true">→</span>
          </button>
        </div>
      </PageContainer>
    </div>
  )
}
