'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { SkillBundleFormatHint } from '@/components/souls/skill-bundle-format-hint'
import { buttonStyles } from '@/components/ui/button'
import { UploadZone } from '@/components/ui/upload-zone'
import { CoverImagePicker } from '@/components/ui/cover-image-picker'
import { cn } from '@/lib/utils/cn'
import { Input, Textarea } from '@/components/ui/input'
import { useImportSoul } from '@/components/providers/import-soul-provider'
import { MAPPING_OPTIONS, type SoulTargetField } from '@/lib/import/field-mapping'
import { SOUL_MD_TEMPLATE } from '@soulidity/sdk'
import { validateSelectedSkillBundle } from '@soulidity/sdk'

const steps = [
  { label: 'Choose Source' },
  { label: 'Upload File' },
  { label: 'Map Fields' },
  { label: 'Preview & Confirm' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

const royaltyOptions = [
  { value: 0, label: 'Off', desc: '0%' },
  { value: 250, label: 'Low', desc: '2.5%' },
  { value: 500, label: 'Standard', desc: '5%', recommended: true },
  { value: 1000, label: 'High', desc: '10%' },
] as const

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(bytes / 1024, 0.1).toFixed(1)} KB`
}

function formatBadge(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'json' || ext === 'character') return 'JSON'
  if (ext === 'md' || ext === 'markdown') return 'Markdown'
  return ext.toUpperCase()
}

function downloadCharacterTemplate() {
  const blob = new Blob([SOUL_MD_TEMPLATE], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'soul.md'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export default function ImportMapPage() {
  const router = useRouter()
  const ctx = useImportSoul()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [skillBundleError, setSkillBundleError] = useState<string | null>(null)
  const [skillBundleName, setSkillBundleName] = useState<string | null>(null)

  // Guard
  useEffect(() => {
    if (ctx.parsedFields.length === 0) router.replace('/import/upload')
  }, [ctx.parsedFields.length, router])

  function handleNext() {
    const nextErrors: Record<string, string> = {}
    if (!ctx.resolvedName.trim()) nextErrors.name = 'Map a field to Soul Name or enter it manually'
    if (!ctx.resolvedDescription.trim()) nextErrors.description = 'Map a field to Description'
    if (!ctx.charFile) nextErrors.charFile = 'Soul Character file is required'
    if (!ctx.memoryFile) nextErrors.memoryFile = 'Memory file (memory.md) is required'
    if (!ctx.coverImageFile) nextErrors.coverImage = 'Cover image is required'
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    router.push('/import/preview')
  }

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

  if (ctx.parsedFields.length === 0) return null

  return (
    <div className="relative z-10 border-t border-purple/20">
      <FlowBar steps={steps} currentStep={2} />

      <PageContainer size="sm" className="space-y-5 pt-7 sm:pt-9">
        <SectionHeader
          label="Import Soul"
          title="Review & Map Fields"
          subtitle="We detected the following fields from your file. Confirm the mapping before minting."
        />

        {/* File banner */}
        {ctx.rawFile && (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card2/60 px-4 py-3">
            <span className="text-lg">📄</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{ctx.rawFile.name}</span>
                <span className="rounded-full border border-teal/30 bg-teal/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-teal">
                  {formatBadge(ctx.rawFile.name)}
                </span>
              </div>
              <span className="text-[11px] text-muted">
                {ctx.parseStats?.fieldCount} fields · {formatSize(ctx.rawFile.size)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => router.push('/import/upload')}
              className="text-xs text-muted hover:text-foreground transition-colors"
            >
              Change
            </button>
          </div>
        )}

        {/* Field Mapping */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card2/60">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border bg-card px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
            <span>Detected Field</span>
            <span />
            <span>Soul Field</span>
          </div>
          {ctx.fieldMappings.map((mapping, i) => {
            const field = ctx.parsedFields.find((f) => f.key === mapping.sourceKey)
            return (
              <div
                key={mapping.sourceKey}
                className={cn(
                  'grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3',
                  i < ctx.fieldMappings.length - 1 && 'border-b border-border/50',
                )}
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-foreground">{mapping.sourceKey}</div>
                  {field && (
                    <div className="mt-0.5 truncate text-[10px] text-muted">
                      {field.type === 'array' ? `${field.entryCount} entries` : field.displayValue}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-muted/40">→</span>
                <select
                  value={mapping.targetField}
                  onChange={(e) => ctx.updateMapping(mapping.sourceKey, e.target.value as SoulTargetField)}
                  className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:border-purple focus:outline-none"
                >
                  {MAPPING_OPTIONS.map((opt) => (
                    <option key={`${mapping.sourceKey}-${opt.value}`} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>

        {/* Manual input for unmapped required fields */}
        {(!ctx.nameMapped || !ctx.descriptionMapped) && (
          <div className="space-y-4 rounded-2xl border border-[var(--ui-value)] bg-[var(--ui-soft-value)] px-4 py-4">
            <div className="flex items-center gap-2">
              <span className="text-[var(--ui-value-text)]">✏️</span>
              <span className="text-[12px] font-semibold text-foreground">Required fields not detected — fill in manually</span>
            </div>

            {!ctx.nameMapped && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-muted">Soul Name</span>
                  <span className="text-xs font-semibold text-danger">*</span>
                  {errors.name && <span className="text-[11px] font-medium text-danger">{errors.name}</span>}
                </div>
                <Input
                  placeholder="e.g. AlphaScout, Kaze no Akira..."
                  value={ctx.manualName}
                  onChange={(e) => ctx.setManualName(e.target.value)}
                  className="h-10 rounded-xl border-[var(--ui-value)] bg-[var(--ui-control-bg)] px-3 placeholder:text-[var(--ui-placeholder)] focus:border-[var(--ui-value)]"
                />
              </div>
            )}

            {!ctx.descriptionMapped && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-muted">Description</span>
                  <span className="text-xs font-semibold text-danger">*</span>
                  {errors.description && <span className="text-[11px] font-medium text-danger">{errors.description}</span>}
                </div>
                <Textarea
                  placeholder="Describe your Soul — what it does, who it's for, what makes it unique..."
                  value={ctx.manualDescription}
                  onChange={(e) => ctx.setManualDescription(e.target.value)}
                  maxLength={6000}
                  className="min-h-[120px] resize-y rounded-xl border-[var(--ui-value)] bg-[var(--ui-control-bg)] px-3 py-2.5 placeholder:text-[var(--ui-placeholder)] focus:border-[var(--ui-value)]"
                />
                <div className="flex items-center justify-between text-[10.5px] text-muted">
                  <span>Autosaves as you type · recommended 400–2000 characters</span>
                  <span className={ctx.manualDescription.length > 5800 ? 'font-semibold text-danger' : 'font-mono'}>
                    {ctx.manualDescription.length.toLocaleString()} / 6,000
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Info note */}
        <div className="rounded-xl border border-purple/20 bg-purple/6 px-4 py-3 text-[11px] leading-5 text-muted">
          <span className="mr-1.5 text-action-label">💡</span>
          Finish the mint-required layers here: Soul Character and founding memory are required. Skills & Docs stay optional and can be added or revised later.
        </div>

        {/* Soul Character section */}
        <section className="rounded-[var(--ui-radius-lg)] border border-[var(--ui-value)] bg-[var(--ui-surface)] px-3.5 py-3.5 shadow-[var(--ui-shadow-sm)] sm:px-4 sm:py-4">
          <div className="flex items-center gap-2">
            <span className="text-[var(--ui-value-text)]">
              <svg viewBox="0 0 20 20" fill="none" className="h-4.5 w-4.5" aria-hidden="true">
                <path d="M5.25 2.75h6.25l4.25 4.25v9.25a1.5 1.5 0 0 1-1.5 1.5h-9a1.5 1.5 0 0 1-1.5-1.5v-12a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M11.5 2.75v4.25h4.25" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M6.75 11.5h6.5M6.75 14.25h4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </span>
            <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">Soul Character</h3>
            <span className="rounded-full border border-[var(--ui-value)] bg-[var(--ui-soft-value)] px-2 py-[1px] text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--ui-value-text)]">
              Required
            </span>
          </div>

          <p className="mt-3 text-[11px] leading-5 text-muted">
            The foundational identity file for this Soul — personality, backstory, traits, tone, and world-rules.
            Required before minting. Upload a <code className="rounded bg-[var(--ui-control-bg)] px-1 font-mono text-[10px] text-[var(--ui-value-text)]">soul.md</code> file using the shared template.
          </p>

          <div className="mt-3">
            {!ctx.charFile ? (
              <>
                <UploadZone
                  icon="📄"
                  label="Click to upload soul.md"
                  sublabel=".md format only · use the shared soul.md template"
                  accept=".md,text/markdown"
                  onFileSelect={ctx.setCharFile}
                  className="rounded-[14px] border-[var(--ui-value)] bg-[var(--ui-control-bg)] px-5 py-8 hover:bg-[var(--ui-soft-value)]"
                />

                {errors.charFile && (
                  <p className="mt-2 text-[11px] font-medium text-danger">{errors.charFile}</p>
                )}

                <button
                  type="button"
                  onClick={downloadCharacterTemplate}
                  className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ui-value-text)] transition hover:text-[var(--ui-value)]"
                >
                  <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                    <path d="M8 2.5v6m0 0 2.25-2.25M8 8.5 5.75 6.25M3 10.75v1.25c0 .69.56 1.25 1.25 1.25h7.5c.69 0 1.25-.56 1.25-1.25v-1.25" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-muted">Don&apos;t have one yet?</span>
                  <span>Download template</span>
                  <span aria-hidden="true">→</span>
                </button>
              </>
            ) : (
              <div className="flex items-start gap-3 rounded-[14px] border border-[var(--ui-value)] bg-[var(--ui-soft-value)] px-3.5 py-3 sm:px-4">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/18 text-success">
                  <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                    <path d="m3.5 8.25 2.5 2.5L12.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-[var(--ui-value-text)]">
                    {ctx.charFile.name} ready for encrypted mint
                  </div>
                  <div className="mt-1 text-[10px] leading-4 text-muted">
                    Validated locally · shared soul.md structure · {formatSize(ctx.charFile.size)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => ctx.setCharFile(null)}
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted/60 transition-colors hover:bg-[var(--ui-surface-muted)] hover:text-foreground"
                  aria-label="Remove file"
                >
                  <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Memory section */}
        <section className="rounded-[var(--ui-radius-lg)] border border-[var(--ui-action)] bg-[var(--ui-surface)] px-3.5 py-3.5 shadow-[var(--ui-shadow-sm)] sm:px-4 sm:py-4">
          <div className="flex items-center gap-2">
            <span className="text-[var(--ui-action)]">
              <svg viewBox="0 0 20 20" fill="none" className="h-4.5 w-4.5" aria-hidden="true">
                <path d="M9.75 17.25V11m0 0c0-2.75 1.9-5.25 5.5-5.5 0 3.95-2.3 5.5-5.5 5.5Zm0 0c0-2.5-1.3-4.65-4.75-5.25 0 3.55 1.95 5.25 4.75 5.25Z" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">Memory</h3>
            <span className="rounded-full border border-[var(--ui-action)] bg-[var(--ui-soft-action)] px-2 py-[1px] text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--ui-action)]">
              Required
            </span>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-muted">
            The founding memory of this Soul — origin context, initial directives, or backstory.
            Locked after mint. Upload as <code className="rounded bg-[var(--ui-control-bg)] px-1 font-mono text-[10px] text-[var(--ui-action)]">memory.md</code> using the founding memory template.
          </p>
          <div className="mt-3">
            {!ctx.memoryFile ? (
              <>
                <UploadZone
                  icon="🌱"
                  label="Click to upload memory.md"
                  sublabel=".md format only · immutable after mint"
                  accept=".md,text/markdown"
                  onFileSelect={ctx.setMemoryFile}
                  className="rounded-[14px] border-[var(--ui-action)] bg-[var(--ui-control-bg)] px-5 py-8 hover:bg-[var(--ui-soft-action)]"
                />
                {errors.memoryFile && (
                  <p className="mt-2 text-[11px] font-medium text-danger">{errors.memoryFile}</p>
                )}
              </>
            ) : (
              <div className="flex items-start gap-3 rounded-[14px] border border-[var(--ui-action)] bg-[var(--ui-soft-action)] px-3.5 py-3 sm:px-4">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/18 text-success">
                  <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                    <path d="m3.5 8.25 2.5 2.5L12.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-[var(--ui-action)]">
                    {ctx.memoryFile.name} ready as founding memory
                  </div>
                  <div className="mt-1 text-[10px] leading-4 text-muted">
                    Encrypted at mint · becomes the first memory entry · {formatSize(ctx.memoryFile.size)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => ctx.setMemoryFile(null)}
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted/60 transition-colors hover:bg-[var(--ui-surface-muted)] hover:text-foreground"
                  aria-label="Remove file"
                >
                  <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Skills & Docs section */}
        <section className="rounded-[var(--ui-radius-lg)] border border-[var(--ui-tech)] bg-[var(--ui-surface)] px-3.5 py-3.5 shadow-[var(--ui-shadow-sm)] sm:px-4 sm:py-4">
          <div className="flex items-center gap-2">
            <span className="text-[var(--ui-tech-text)]">
              <svg viewBox="0 0 20 20" fill="none" className="h-4.5 w-4.5" aria-hidden="true">
                <path d="M10 2.75 16 6v8L10 17.25 4 14V6l6-3.25Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
                <path d="M4 6 10 9.25 16 6M10 9.25v8" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
              </svg>
            </span>
            <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">Skills & Docs</h3>
            <span className="rounded-full border border-[var(--ui-tech)] bg-[var(--ui-soft-tech)] px-2 py-[1px] text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--ui-tech-text)]">
              Optional
            </span>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-muted">
            Knowledge docs, skill definitions, system prompts, and behavioral configs.
            Use a ZIP bundle with <code className="rounded bg-[var(--ui-control-bg)] px-1 font-mono text-[10px] text-[var(--ui-tech-text)]">SKILL.md</code> frontmatter. Private bundles are encrypted by default and can be revised later.
          </p>
          <div className="mt-3">
            {!ctx.skillsFile ? (
              <>
                <UploadZone
                  icon="📦"
                  label="Click to upload bundle file"
                  sublabel=".zip only · encrypted via Seal"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  onFileSelect={(file) => {
                    void handleSkillsFileSelect(file)
                  }}
                  className="rounded-[14px] border-[var(--ui-tech)] bg-[var(--ui-control-bg)] px-5 py-8 hover:bg-[var(--ui-soft-tech)]"
                />
                <SkillBundleFormatHint error={skillBundleError} className="mt-3" />
              </>
            ) : (
              <div className="flex items-start gap-3 rounded-[14px] border border-[var(--ui-tech)] bg-[var(--ui-soft-tech)] px-3.5 py-3 sm:px-4">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/18 text-success">
                  <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                    <path d="m3.5 8.25 2.5 2.5L12.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-[var(--ui-tech-text)]">
                    Skills & Docs bundle ready
                  </div>
                  <div className="mt-1 text-[10px] leading-4 text-muted">
                    Skill: {skillBundleName ?? 'read from SKILL.md'} · ZIP bundle verified locally · {formatSize(ctx.skillsFile.size)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    ctx.setSkillsFile(null)
                    setSkillBundleName(null)
                    setSkillBundleError(null)
                  }}
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted/60 transition-colors hover:bg-[var(--ui-surface-muted)] hover:text-foreground"
                  aria-label="Remove file"
                >
                  <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Cover Image */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="page-kicker text-muted">Preview Image</span>
            <span className="text-xs font-semibold text-danger">*</span>
            {errors.coverImage && <span className="text-[11px] font-medium text-danger">{errors.coverImage}</span>}
          </div>
          <CoverImagePicker
            file={ctx.coverImageFile}
            previewUrl={ctx.coverImagePreviewUrl}
            onChange={(file) => ctx.setCoverImage(file)}
            className="rounded-[var(--ui-radius-lg)] border-[var(--ui-border)] bg-[var(--ui-control-bg)] px-6 py-10 text-center hover:border-[var(--ui-action)] hover:bg-[var(--ui-soft-action)]"
          />
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="page-kicker text-muted">Tags (comma-separated)</span>
          </div>
          <Input
            placeholder="e.g. ai, trading, signals"
            value={ctx.tags}
            onChange={(e) => ctx.setTags(e.target.value)}
            className="h-11 rounded-xl border-[var(--ui-border)] bg-[var(--ui-control-bg)] px-4 placeholder:text-[var(--ui-placeholder)] focus:border-[var(--ui-action)]"
          />
        </div>

        {/* Creator Royalty */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="page-kicker text-muted">Creator Royalty</span>
            <span className="text-[11px] font-medium text-muted/80">(optional)</span>
          </div>
          <div className="grid grid-cols-4 gap-2.5">
            {royaltyOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={ctx.royalty === opt.value}
                onClick={() => ctx.setRoyalty(opt.value)}
                className={`relative flex min-h-[72px] min-w-0 flex-col items-center justify-center rounded-2xl border px-2 pb-3 pt-3 text-center transition ${
                  ctx.royalty === opt.value
                    ? 'border-[var(--ui-action)] bg-[var(--ui-soft-action)] shadow-[var(--ui-shadow-action)]'
                    : 'border-[var(--ui-border)] bg-[var(--ui-surface-muted)] hover:border-[var(--ui-action)] hover:bg-[var(--ui-soft-action)]'
                }`}
              >
                {'recommended' in opt && opt.recommended ? (
                  <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--ui-tech)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ui-tech-action-text)] shadow-[var(--ui-shadow-sm)]">
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

        {/* Navigation */}
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
          <Link
            href="/import/upload"
            className={buttonStyles({
              variant: 'outline',
              size: 'lg',
              className: 'w-full rounded-[10px] border-purple/20 bg-transparent px-4 py-2.5 text-[13px] text-foreground hover:border-purple/45 hover:text-foreground sm:w-auto sm:min-w-[76px]',
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
              className: 'rounded-[10px] px-4 py-2.5 text-[13px] shadow-[var(--ui-shadow-action)]',
            })}
          >
            Next: Preview <span aria-hidden="true">→</span>
          </button>
        </div>
      </PageContainer>
    </div>
  )
}
