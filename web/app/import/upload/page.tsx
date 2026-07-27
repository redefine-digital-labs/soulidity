'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'
import { useImportSoul } from '@/components/providers/import-soul-provider'
import { parseImportFile, computeFileHash } from '@/lib/import/file-parser'

const steps = [
  { label: 'Choose Source' },
  { label: 'Upload File' },
  { label: 'Map Fields' },
  { label: 'Preview & Confirm' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

const MAX_FILE_SIZE = 15 * 1024 * 1024 // 15 MB
const ACCEPT = '.json,.md,.txt,.character,application/json,text/markdown,text/plain'

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(bytes / 1024, 0.1).toFixed(1)} KB`
}

function formatBadge(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'json' || ext === 'character') return 'JSON'
  if (ext === 'md' || ext === 'markdown') return 'Markdown'
  if (ext === 'txt') return 'Text'
  return ext.toUpperCase()
}

export default function ImportUploadPage() {
  const router = useRouter()
  const ctx = useImportSoul()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const parseRequestIdRef = useRef(0)

  // Guard
  useEffect(() => {
    if (!ctx.sourceType) router.replace('/import')
  }, [ctx.sourceType, router])

  async function handleFile(file: File) {
    if (file.size > MAX_FILE_SIZE) {
      ctx.setParseError(`File too large (${formatSize(file.size)}). Maximum is ${formatSize(MAX_FILE_SIZE)}.`)
      return
    }

    const requestId = ++parseRequestIdRef.current
    ctx.setRawFile(file)
    ctx.setParseError(null)
    setParsing(true)

    try {
      const [result, hash] = await Promise.all([
        parseImportFile(file),
        computeFileHash(file),
      ])

      // Ignore stale result if a newer file was selected while parsing
      if (parseRequestIdRef.current !== requestId) return

      ctx.setParsedFields(result.fields)
      ctx.setParseStats(result.stats)
      ctx.setFieldMappings(result.suggestedMappings)
      ctx.setOriginRef(`sha256:${hash}`)
    } catch (err) {
      if (parseRequestIdRef.current !== requestId) return
      ctx.setRawFile(null)
      ctx.setParseError(err instanceof Error ? err.message : 'Failed to parse file')
    } finally {
      if (parseRequestIdRef.current === requestId) setParsing(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  function handleClear() {
    ctx.setRawFile(null)
  }

  if (!ctx.sourceType) return null

  const hasFile = !!ctx.rawFile && !!ctx.parseStats && !ctx.parseError
  const score = ctx.parseStats?.parsingScore ?? 0

  return (
    <div className="relative z-10 border-t border-purple/20">
      <FlowBar steps={steps} currentStep={1} />

      <PageContainer size="sm" className="space-y-5 pt-7 sm:pt-9">
        <SectionHeader
          label="Import Soul"
          title="Upload File"
          subtitle="Upload your imported Soul file. Supported formats: .JSON, .character, markdown."
        />

        {/* Upload zone */}
        <div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            onChange={handleInputChange}
            className="sr-only"
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/35 ${
              dragging
                ? 'border-purple bg-purple/10'
                : hasFile
                  ? 'border-success/50 bg-success/5'
                  : 'border-purple/40 bg-[rgba(20,11,44,0.72)] hover:border-purple hover:bg-purple/6'
            }`}
          >
            {parsing ? (
              <>
                <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-purple/30 border-t-purple" />
                <span className="text-sm font-semibold text-foreground">Parsing file...</span>
              </>
            ) : hasFile ? (
              <>
                <span className="mb-2 text-3xl">📄</span>
                <span className="text-sm font-semibold text-foreground">{ctx.rawFile!.name}</span>
                <span className="mt-1 text-xs text-muted">Click to replace</span>
              </>
            ) : (
              <>
                <span className="mb-3 text-3xl text-muted/60">📂</span>
                <span className="text-sm font-semibold text-foreground">Click to select a file</span>
                <span className="mt-1.5 text-[11px] text-muted">
                  or drag & drop here
                </span>
                <span className="mt-2 text-[10px] text-muted/70">
                  .JSON · Markdown · max {formatSize(MAX_FILE_SIZE)}
                </span>
              </>
            )}
          </button>
        </div>

        {/* Parse error */}
        {ctx.parseError && (
          <div className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
            {ctx.parseError}
          </div>
        )}

        {/* File stats */}
        {hasFile && ctx.parseStats && (
          <div className="rounded-xl border border-border bg-card2/60 px-4 py-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-semibold text-foreground">{ctx.rawFile!.name}</span>
                <span className="rounded-full border border-purple/30 bg-purple/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-action-label">
                  {formatBadge(ctx.rawFile!.name)}
                </span>
              </div>
              <button
                type="button"
                onClick={handleClear}
                className="text-xs text-muted hover:text-foreground transition-colors"
              >
                Remove
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
              <span>{ctx.parseStats.fieldCount} fields</span>
              <span className="opacity-40">·</span>
              <span>{ctx.parseStats.entryCount} total entries/values</span>
              <span className="opacity-40">·</span>
              <span>{formatSize(ctx.parseStats.sizeBytes)}</span>
            </div>
            {/* Score bar */}
            <div className="mt-3 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/50">
                <div
                  className="h-full rounded-full bg-success transition-all duration-500"
                  style={{ width: `${score}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-success">{score}%</span>
            </div>
          </div>
        )}

        {/* Soul Explorer info card */}
        <div className="rounded-2xl border border-purple/20 bg-card2/55 px-4 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-purple/15 text-sm text-action-label">
              🔍
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-foreground">Soul Explorer</span>
                <span className="rounded-full border border-teal/30 bg-teal/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-teal">
                  Auto-Detect
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                Soul trait files, Claude Projects, and compressed platforms have complex data
                that will be auto-detected and mapped — no manual import needed.
              </p>
            </div>
          </div>

          {/* Expected fields */}
          <div className="mt-3.5 border-t border-purple/15 pt-3.5">
            <p className="mb-2.5 text-[11px] font-semibold text-foreground">Expected Fields</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {[
                { field: 'name', label: 'Name', desc: 'Soul name or title', required: true },
                { field: 'description', label: 'Description', desc: 'Bio or summary', required: true },
                { field: 'avatar', label: 'Avatar / Image', desc: 'Profile image URL', required: false },
                { field: 'memory', label: 'Memory', desc: 'Context, knowledge, or logs', required: false },
                { field: 'skills', label: 'Skills', desc: 'Tools, abilities, or plugins', required: false },
                { field: 'config', label: 'Config', desc: 'System prompt or settings', required: false },
              ].map((item) => (
                <div key={item.field} className="flex items-start gap-2 rounded-lg bg-black/15 px-2.5 py-2">
                  <code className="shrink-0 rounded bg-purple/10 px-1.5 py-0.5 font-mono text-[10px] text-action-label">
                    {item.field}
                  </code>
                  <div className="min-w-0">
                    <span className="text-[11px] text-foreground">{item.label}</span>
                    {item.required && <span className="ml-1 text-[9px] font-bold text-danger">*</span>}
                    <p className="text-[10px] leading-4 text-muted">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2.5 text-[10px] leading-4 text-muted">
              Fields are matched by keyword — e.g. <code className="rounded bg-black/20 px-1 font-mono text-[9px] text-action-label">bio</code>, <code className="rounded bg-black/20 px-1 font-mono text-[9px] text-action-label">system_prompt</code>, <code className="rounded bg-black/20 px-1 font-mono text-[9px] text-action-label">personality</code> will also be detected.
              Unrecognized fields can be manually mapped in the next step.
            </p>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
          <Link
            href="/import"
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
            disabled={!hasFile}
            onClick={() => router.push('/import/map')}
            className={buttonStyles({
              variant: 'landing',
              size: 'lg',
              full: true,
              className: `rounded-[10px] px-4 py-2.5 text-[13px] shadow-[0_14px_34px_rgba(124,58,237,0.34)] ${!hasFile ? 'pointer-events-none opacity-45' : ''}`,
            })}
          >
            Review Fields <span aria-hidden="true">→</span>
          </button>
        </div>
      </PageContainer>
    </div>
  )
}
