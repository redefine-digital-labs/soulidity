'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Input, Textarea } from '@/components/ui/input'
import { buttonStyles } from '@/components/ui/button'
import { CoverImagePicker } from '@/components/ui/cover-image-picker'
import { useCreateSoul } from '@/components/providers/create-soul-provider'

interface DesktopMintHandoffPayload {
  name: string
  description: string
  tags: string[]
  royaltyBps: number
  soulMarkdown: string
  memoryMarkdown: string
  coverImageDataUrl: string
  coverImageFileName: string
  coverImageMimeType: string
  coverImagePrompt: string
  characterType: string
  extraDescription: string
  skillsArchive: {
    fileName: string
    mimeType: string
    dataBase64: string
  } | null
}

function dataUrlToFile(dataUrl: string, fileName: string, fallbackMime: string): Promise<File> {
  return fetch(dataUrl)
    .then((r) => r.blob())
    .then((blob) => new File([blob], fileName || 'cover', { type: blob.type || fallbackMime || 'application/octet-stream' }))
}

function base64ToFile(base64: string, fileName: string, mimeType: string): File {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], { type: mimeType || 'application/octet-stream' })
  return new File([blob], fileName, { type: blob.type })
}

function markdownToFile(text: string, fileName: string): File {
  const blob = new Blob([text], { type: 'text/markdown' })
  return new File([blob], fileName, { type: 'text/markdown' })
}

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
  const searchParams = useSearchParams()
  const ctx = useCreateSoul()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const collectionOnChainId = searchParams.get('collectionId')?.trim() ?? ''
  const { setCollectionBindTarget } = ctx

  useEffect(() => {
    setCollectionBindTarget(
      collectionOnChainId ? { collectionOnChainId } : null,
    )
  }, [collectionOnChainId, setCollectionBindTarget])

  // ── Desktop "Mint By Web" hand-off hydration ────────────────────────────
  // The desktop app POSTs the local draft to /api/desktop/mint-handoff and
  // opens this page with `?handoff=<token>`. We GET the payload once (server
  // marks it consumed), inject the fields into the CreateSoulProvider, then
  // strip the token from the URL. The hydrate is best-effort — failures
  // (token expired, accountId mismatch, network) leave the page in its
  // default empty state so the user can fill the form manually.
  const handoffToken = (searchParams.get('handoff')?.trim() ?? '')
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  // Track the last token value we attempted, not a single-shot boolean. A
  // boolean would lock out every subsequent hand-off opened into this
  // mounted page (e.g. desktop opens a second Mint By Web URL into the same
  // tab, or the user pastes a fresh `?handoff=<token>` while still on /create),
  // dropping the user's latest draft silently.
  const handoffStartedTokenRef = useRef<string | null>(null)
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const [isHydratingHandoff, setIsHydratingHandoff] = useState(false)

  useEffect(() => {
    if (!handoffToken || handoffStartedTokenRef.current === handoffToken) return
    handoffStartedTokenRef.current = handoffToken
    // A new token supersedes any prior hand-off's surfaced error / loading
    // copy so the UI reflects the new attempt rather than stale messaging
    // from the previous token.
    setHandoffError(null)

    let cancelled = false
    setIsHydratingHandoff(true)

    void (async () => {
      try {
        const res = await fetch(
          `/api/desktop/mint-handoff/${encodeURIComponent(handoffToken)}`,
          { credentials: 'include', cache: 'no-store' },
        )
        if (!res.ok) {
          let message = `Hand-off failed: ${res.status}`
          try {
            const body = await res.json()
            if (body && typeof body.error === 'string') message = body.error
          } catch { /* ignore */ }
          throw new Error(message)
        }
        const body = (await res.json()) as { payload?: unknown }
        const payload = body.payload as DesktopMintHandoffPayload | undefined
        if (!payload || cancelled) return

        const c = ctxRef.current
        c.setName(typeof payload.name === 'string' ? payload.name : '')
        c.setDescription(typeof payload.description === 'string' ? payload.description : '')
        c.setTags(Array.isArray(payload.tags) ? payload.tags.join(', ') : '')
        if (typeof payload.royaltyBps === 'number' && Number.isFinite(payload.royaltyBps)) {
          c.setRoyalty(Math.max(0, Math.min(2500, Math.round(payload.royaltyBps))))
        }

        if (payload.coverImageDataUrl && payload.coverImageMimeType !== 'image/svg+xml') {
          try {
            const file = await dataUrlToFile(
              payload.coverImageDataUrl,
              payload.coverImageFileName || 'cover',
              payload.coverImageMimeType || 'image/png',
            )
            if (!cancelled) c.setCoverImage(file)
          } catch (err) {
            console.warn('[create] cover hand-off failed to decode', err)
          }
        }

        if (typeof payload.soulMarkdown === 'string' && payload.soulMarkdown) {
          c.setCharFile(markdownToFile(payload.soulMarkdown, 'soul.md'))
        }
        if (typeof payload.memoryMarkdown === 'string' && payload.memoryMarkdown) {
          c.setMemoryFile(markdownToFile(payload.memoryMarkdown, 'memory.md'))
        }
        if (payload.skillsArchive?.dataBase64) {
          try {
            const file = base64ToFile(
              payload.skillsArchive.dataBase64,
              payload.skillsArchive.fileName || 'skills.zip',
              payload.skillsArchive.mimeType || 'application/zip',
            )
            c.setSkillsFile(file)
          } catch (err) {
            console.warn('[create] skills.zip hand-off failed to decode', err)
          }
        }

        // Strip the consumed token from the URL — keeps refreshes / shares
        // from re-issuing the GET (server returns 410 on second use anyway,
        // but a clean URL avoids surfacing that error to the user).
        const url = new URL(window.location.href)
        url.searchParams.delete('handoff')
        router.replace(`${url.pathname}${url.search}${url.hash}`)
      } catch (err) {
        if (!cancelled) {
          setHandoffError(err instanceof Error ? err.message : 'Mint hand-off failed.')
        }
      } finally {
        if (!cancelled) setIsHydratingHandoff(false)
      }
    })()

    return () => { cancelled = true }
  }, [handoffToken, router])

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
        {isHydratingHandoff && (
          <div className="rounded-xl border border-purple/35 bg-card2/60 px-4 py-3 text-sm text-muted">
            Importing draft from desktop...
          </div>
        )}
        {handoffError && (
          <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            Mint hand-off failed: {handoffError}. You can still fill the form manually below.
          </div>
        )}
        <SectionHeader
          label="Create Soul"
          title={ctx.collectionBindTarget ? 'Step 1 — Add Soul to Collection' : 'Step 1 — Basic Info'}
          subtitle={ctx.collectionBindTarget ? 'This Soul will be bound to the selected collection after mint.' : undefined}
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
            <CoverImagePicker
              file={ctx.coverImageFile}
              previewUrl={ctx.coverImagePreviewUrl}
              onChange={(file) => ctx.setCoverImage(file)}
              className="rounded-[20px] border-purple/40 bg-[rgba(20,11,44,0.72)] px-6 py-10 text-center hover:border-purple hover:bg-purple/6"
            />
          </div>

          <div className="space-y-2">
            <FieldLabel label="Creator Royalty" optional />
            <div className="grid grid-cols-4 gap-2.5">
              {royaltyOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={ctx.royalty === opt.value}
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
              <span className="font-semibold text-foreground">Typical on Soulidity: 5%</span> — you earn this share on every future resale, forever. Locked at mint and cannot be changed.
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
