'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { UploadZone } from '@/components/ui/upload-zone'
import { buttonStyles } from '@/components/ui/button'
import {
  useCreateCollection,
  collectionSteps,
  type BatchSoulEntry,
  type SoulFolderMap,
} from '@/components/providers/create-collection-provider'
import { downloadTemplate, processFolderUpload } from './batch-utils'

// ── Method card definitions ──

type MethodId = 'create-new' | 'batch-upload' | 'add-souls'

const methods: { id: MethodId; icon: string; title: string; desc: string; enabled: boolean }[] = [
  {
    id: 'create-new',
    icon: '✦',
    title: 'Create New',
    desc: 'Design each Soul individually with full control over character, seed, and price',
    enabled: false,
  },
  {
    id: 'batch-upload',
    icon: '📦',
    title: 'Batch Upload',
    desc: 'Upload a folder with template + soul.md / memory.md / images per subfolder',
    enabled: true,
  },
  {
    id: 'add-souls',
    icon: '🔗',
    title: 'Add Souls',
    desc: 'Link on-chain Souls you already own — permission-checked before binding',
    enabled: false,
  },
]

// ── Pending folder result (shown in confirmation modal) ──

interface PendingFolderResult {
  templateFile: File | null
  souls: BatchSoulEntry[]
  soulFolders: SoulFolderMap
  errors: string[]
  folderErrors: string[]
}

// ── Page ──

export default function AddSoulsPage() {
  const router = useRouter()
  const ctx = useCreateCollection()
  const [error, setError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [pending, setPending] = useState<PendingFolderResult | null>(null)
  const missingStep1 = !ctx.name.trim() || !ctx.description.trim() || !ctx.coverImageFile

  useEffect(() => {
    if (missingStep1) {
      router.replace('/collections/create')
    }
  }, [missingStep1, router])

  if (missingStep1) {
    return null
  }

  async function handleFolderSelect(files: FileList) {
    setParsing(true)
    setError(null)
    try {
      const cap = ctx.supplyCap ? parseInt(ctx.supplyCap, 10) : undefined
      const result = await processFolderUpload(
        files,
        ctx.extraRoyaltyBps,
        Number.isFinite(cap) ? cap : undefined,
      )
      // Show confirmation modal instead of committing directly
      setPending(result)
    } catch {
      setPending({
        templateFile: null,
        souls: [],
        soulFolders: new Map(),
        errors: ['Failed to process folder. Please check the structure.'],
        folderErrors: [],
      })
    }
    setParsing(false)
  }

  function handleConfirmUpload() {
    if (!pending) return
    ctx.setBatchData(pending.templateFile, pending.souls, pending.errors)
    ctx.setSoulFolders(pending.soulFolders)
    ctx.setFolderErrors(pending.folderErrors)
    setPending(null)
  }

  function handleCancelUpload() {
    setPending(null)
  }

  function handleNext() {
    if (!ctx.addSoulsMethod) {
      setError('Please choose a method above before continuing.')
      return
    }
    if (!ctx.batchFile) {
      setError('Please upload a folder containing the template and soul files.')
      return
    }
    if (ctx.batchErrors.length > 0) {
      setError('Please fix the template errors before continuing.')
      return
    }
    if (ctx.folderErrors.length > 0) {
      setError('Please fix the folder structure errors before continuing.')
      return
    }
    if (ctx.batchSouls.length === 0) {
      setError('No valid Souls found in the template.')
      return
    }
    setError(null)
    router.push('/collections/create/preview')
  }

  function handleSwitchMethod() {
    ctx.setAddSoulsMethod(null)
    ctx.setBatchData(null, [], [])
    ctx.setSoulFolders(new Map())
    ctx.setFolderErrors([])
    setError(null)
  }

  function handleReplace() {
    ctx.setBatchData(null, [], [])
    ctx.setSoulFolders(new Map())
    ctx.setFolderErrors([])
    setError(null)
  }

  const showBatchFlow = ctx.addSoulsMethod === 'batch-upload'
  const hasData = ctx.batchFile && ctx.batchSouls.length > 0

  // Modal helpers
  const pendingHasErrors = pending
    ? pending.errors.length > 0 || pending.folderErrors.length > 0
    : false
  const pendingAllGood = pending
    ? pending.souls.length > 0 && !pendingHasErrors
    : false

  return (
    <>
      <FlowBar steps={collectionSteps} currentStep={1} />

      <div className="relative z-10 border-t border-purple/20">
        <PageContainer size="sm" className="space-y-6 pt-7 sm:pt-9">
          <SectionHeader
            label="Create Soul Collection"
            title="Step 2 — Add Souls"
            subtitle="Add Souls to your collection. Choose one method — this applies to all Souls in this collection."
            className="mb-2"
          />

          {!showBatchFlow ? (
            /* ── Method selection cards ── */
            <div className="space-y-4">
              <p className="text-[13px] leading-6 text-muted">
                Choose how to add Souls to this Collection — you can only use one method per collection:
              </p>
              <div className="grid grid-cols-3 gap-4">
                {methods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!m.enabled}
                    onClick={() => {
                      if (m.enabled) {
                        ctx.setAddSoulsMethod(m.id as 'batch-upload')
                        setError(null)
                      }
                    }}
                    className={`group relative flex min-h-[160px] flex-col items-center justify-center rounded-2xl border px-4 pb-5 pt-6 text-center transition ${
                      ctx.addSoulsMethod === m.id
                        ? 'border-purple bg-purple/12 shadow-[0_10px_24px_rgba(124,58,237,0.18)]'
                        : m.enabled
                          ? 'border-border bg-card2/40 hover:border-purple/40 hover:bg-purple/6 cursor-pointer'
                          : 'border-border/50 bg-card2/20 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className="mb-3 text-2xl leading-none" aria-hidden="true">
                      {m.icon}
                    </div>
                    <div className="font-display text-sm font-bold tracking-[-0.02em] text-foreground">
                      {m.title}
                    </div>
                    <p className="mt-2 text-[12px] leading-[18px] text-muted">
                      {m.desc}
                    </p>
                    {!m.enabled && (
                      <span className="absolute right-2.5 top-2.5 rounded-full bg-muted/20 px-2 py-0.5 text-[10px] font-semibold text-muted">
                        Soon
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ── Batch Upload flow ── */
            <div className="space-y-4">
              {/* Method banner */}
              <div className="flex items-center justify-between rounded-2xl border border-border bg-card2/55 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-xl leading-none" aria-hidden="true">📦</span>
                  <span className="text-sm text-foreground">
                    Method: <span className="font-bold">Batch Upload</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSwitchMethod}
                  className="text-[13px] font-medium text-muted transition-colors hover:text-purple"
                >
                  Switch method →
                </button>
              </div>

              {/* Folder structure explanation */}
              <div className="rounded-2xl border border-purple/25 bg-purple/5 px-5 py-4">
                <p className="mb-2 text-[13px] leading-6 text-muted">
                  <span className="font-semibold text-foreground">Prepare a folder</span> with this structure:
                </p>
                <pre className="rounded-lg bg-black/30 px-4 py-3 text-xs leading-5 text-muted">
{`my-collection/
  template.xlsx        ← filled template
  1/                   ← Row 1
    soul.md            ← character file (required)
    memory.md          ← memory (required)
    image.png          ← preview image (optional)
  2/                   ← Row 2
    soul.md
    memory.md
  ...`}
                </pre>
              </div>

              {/* Download template */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => downloadTemplate('xlsx')}
                  className={buttonStyles({
                    variant: 'outline',
                    size: 'sm',
                    className: 'gap-2 rounded-lg border-border bg-card2/80 hover:border-purple',
                  })}
                >
                  <span aria-hidden="true">↓</span> Download template (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() => downloadTemplate('csv')}
                  className="text-[13px] text-muted transition-colors hover:text-purple"
                >
                  or .csv
                </button>
              </div>

              {/* Folder upload zone / committed result */}
              {!hasData ? (
                <UploadZone
                  icon="📂"
                  label="Select your collection folder"
                  sublabel="Folder with template + numbered subfolders"
                  directory
                  onFilesSelect={handleFolderSelect}
                  className="rounded-[20px] border-purple/40 bg-[rgba(20,11,44,0.72)] px-6 py-10 hover:border-purple hover:bg-purple/6"
                />
              ) : (
                <div className="space-y-3">
                  {/* Folder info */}
                  <div className="flex items-center gap-4 rounded-xl border border-purple/30 bg-card2/75 px-4 py-3">
                    <span className="text-xl" aria-hidden="true">📂</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {ctx.batchFile?.name ?? 'Template'}
                      </div>
                      <div className="text-xs text-muted">
                        {ctx.batchSouls.length} Soul{ctx.batchSouls.length !== 1 ? 's' : ''} · {ctx.soulFolders.size} folder{ctx.soulFolders.size !== 1 ? 's' : ''} matched
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleReplace}
                      className="shrink-0 rounded-lg border border-purple/25 px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-purple/45 hover:text-foreground"
                    >
                      Replace
                    </button>
                  </div>

                  {/* Errors */}
                  {ctx.batchErrors.length > 0 && (
                    <div className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
                      <p className="mb-1.5 text-xs font-semibold text-danger">Template errors:</p>
                      {ctx.batchErrors.map((err, i) => (
                        <p key={i} className="text-xs leading-5 text-danger/80">&bull; {err}</p>
                      ))}
                    </div>
                  )}
                  {ctx.folderErrors.length > 0 && (
                    <div className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
                      <p className="mb-1.5 text-xs font-semibold text-danger">Folder errors:</p>
                      {ctx.folderErrors.map((err, i) => (
                        <p key={i} className="text-xs leading-5 text-danger/80">&bull; {err}</p>
                      ))}
                    </div>
                  )}

                  {/* All good */}
                  {ctx.batchErrors.length === 0 && ctx.folderErrors.length === 0 && (
                    <div className="rounded-xl border border-teal/30 bg-teal/8 px-4 py-3">
                      <p className="text-xs font-semibold text-teal">
                        {ctx.batchSouls.length} Soul{ctx.batchSouls.length !== 1 ? 's' : ''} ready — all files matched
                      </p>
                    </div>
                  )}
                </div>
              )}

              {parsing && (
                <p className="text-xs text-muted animate-pulse">Processing folder...</p>
              )}
            </div>
          )}

          {/* Validation error */}
          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
              <p className="text-[13px] font-medium text-danger">{error}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <Link
              href="/collections/create"
              className={buttonStyles({
                variant: 'outline',
                size: 'lg',
                className: 'w-[112px] rounded-xl border-border bg-transparent text-foreground hover:border-purple hover:text-foreground',
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
                className: 'min-w-0 flex-1 rounded-xl',
              })}
            >
              Next: Preview <span aria-hidden="true">→</span>
            </button>
          </div>

          {/* Draft auto-save notice */}
          <p className="text-center text-xs text-muted/60">
            Draft auto-saved · You can exit and resume from My Souls → Collections → Drafts
          </p>
        </PageContainer>
      </div>

      {/* ── Upload confirmation modal ── */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-lg rounded-2xl border border-purple/40 bg-[linear-gradient(135deg,rgba(28,17,63,0.97),rgba(18,10,41,0.98))] p-6 shadow-[0_24px_64px_rgba(124,58,237,0.3)]">
            {/* Header */}
            <h3 className="mb-1 text-lg font-bold text-foreground">Confirm Upload</h3>
            <p className="mb-5 text-sm text-muted">
              {pending.templateFile
                ? <>Template: <span className="font-semibold text-foreground">{pending.templateFile.name}</span></>
                : 'No template found'}
            </p>

            {/* Soul + folder summary */}
            {pending.souls.length > 0 && (
              <div className="mb-4 max-h-56 overflow-y-auto rounded-xl border border-border/50 bg-card2/40 px-4 py-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                  {pending.souls.length} Soul{pending.souls.length !== 1 ? 's' : ''} found
                </p>
                <div className="space-y-1.5">
                  {pending.souls.map((soul, i) => {
                    const num = i + 1
                    const folder = pending.soulFolders.get(num)
                    return (
                      <div key={num} className="flex items-center gap-3 text-xs">
                        <span className="w-5 text-right font-mono text-muted">{num}</span>
                        <span className="min-w-0 flex-1 truncate text-foreground">{soul.name}</span>
                        <span className={folder?.characterFile ? 'text-teal' : 'text-danger'}>
                          {folder?.characterFile ? '✓' : '✗'} soul
                        </span>
                        <span className={folder?.memoryFile ? 'text-teal' : 'text-danger'}>
                          {folder?.memoryFile ? '✓' : '✗'} mem
                        </span>
                        <span className={folder?.imageFile ? 'text-purple' : 'text-muted/40'}>
                          {folder?.imageFile ? '✓' : '—'} img
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Errors */}
            {pending.errors.length > 0 && (
              <div className="mb-3 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
                <p className="mb-1 text-xs font-semibold text-danger">Template errors:</p>
                {pending.errors.map((err, i) => (
                  <p key={i} className="text-xs leading-5 text-danger/80">&bull; {err}</p>
                ))}
              </div>
            )}
            {pending.folderErrors.length > 0 && (
              <div className="mb-3 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
                <p className="mb-1 text-xs font-semibold text-danger">Folder errors:</p>
                {pending.folderErrors.map((err, i) => (
                  <p key={i} className="text-xs leading-5 text-danger/80">&bull; {err}</p>
                ))}
              </div>
            )}

            {/* All good badge */}
            {pendingAllGood && (
              <div className="mb-4 rounded-xl border border-teal/30 bg-teal/8 px-4 py-3">
                <p className="text-xs font-semibold text-teal">
                  All files matched — ready to proceed
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCancelUpload}
                className={buttonStyles({
                  variant: 'outline',
                  size: 'lg',
                  className: 'flex-1 rounded-xl border-border bg-transparent text-foreground hover:border-purple hover:text-foreground',
                })}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending.souls.length === 0 || pendingHasErrors}
                onClick={handleConfirmUpload}
                className={buttonStyles({
                  variant: 'landing',
                  size: 'lg',
                  className: `flex-1 rounded-xl ${pending.souls.length === 0 || pendingHasErrors ? 'opacity-50 cursor-not-allowed' : ''}`,
                })}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
