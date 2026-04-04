'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Input, Textarea } from '@/components/ui/input'
import { UploadZone } from '@/components/ui/upload-zone'
import { buttonStyles } from '@/components/ui/button'
import { useCollectionActions } from '@/lib/hooks/use-collections'
import {
  getCreateCollectionFormState,
  getCreateCollectionRedirectHref,
  type CreateCollectionFormValues,
} from '@/lib/collections/create-form-state'

const royaltyOptions = [
  { value: 0, label: 'Off', desc: '0% royalty' },
  { value: 250, label: 'Low', desc: '2.5% on resale' },
  { value: 500, label: 'Standard', desc: '5% on resale' },
  { value: 1000, label: 'High', desc: '10% on resale' },
  { value: 2500, label: 'Max', desc: '25% on resale' },
] as const

const initialForm: CreateCollectionFormValues = {
  name: '',
  description: '',
  imageUrl: '',
  extraRoyaltyBps: 500,
  tradeable: true,
}

type TouchedState = {
  name: boolean
  description: boolean
  imageUrl: boolean
}

const initialTouched: TouchedState = {
  name: false,
  description: false,
  imageUrl: false,
}

const statusCopy = {
  idle: null,
  building: 'Preparing transaction...',
  signing: 'Waiting for wallet signature...',
  syncing: 'Syncing the new Collection from chain...',
  done: 'Collection created. Redirecting...',
  error: null,
} as const

function shouldShowError(touched: boolean, submitAttempted: boolean) {
  return touched || submitAttempted
}

export default function CreateCollectionPage() {
  const router = useRouter()
  const [form, setForm] = useState(initialForm)
  const [touched, setTouched] = useState(initialTouched)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const { createCollection, createStatus, error, txDigest } = useCollectionActions(null)
  const formState = getCreateCollectionFormState(form)
  const isSubmitting = createStatus === 'building' || createStatus === 'signing' || createStatus === 'syncing'

  // --- Image file state (browser-only preview, upload on submit) ---
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const prevPreviewUrlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (prevPreviewUrlRef.current) URL.revokeObjectURL(prevPreviewUrlRef.current)
    }
  }, [])

  function handleImageSelect(file: File) {
    if (prevPreviewUrlRef.current) URL.revokeObjectURL(prevPreviewUrlRef.current)
    const url = URL.createObjectURL(file)
    prevPreviewUrlRef.current = url
    setImageFile(file)
    setImagePreviewUrl(url)
    setForm((current) => ({ ...current, imageUrl: '' }))
  }

  function handleImageClear() {
    if (prevPreviewUrlRef.current) URL.revokeObjectURL(prevPreviewUrlRef.current)
    prevPreviewUrlRef.current = null
    setImageFile(null)
    setImagePreviewUrl(null)
  }

  // When imageFile is present, skip imageUrl validation (URL is resolved on submit)
  const isReady = imageFile
    ? !formState.fieldErrors.name && !formState.fieldErrors.description && !formState.fieldErrors.extraRoyaltyBps
    : formState.isComplete

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitAttempted(true)
    if (!isReady || isSubmitting) {
      return
    }

    try {
      const result = await createCollection({ ...form, imageFile })
      router.push(getCreateCollectionRedirectHref(result))
    } catch {
      // Hook state already captures the user-facing error.
    }
  }

  const visibleErrors = {
    name: shouldShowError(touched.name, submitAttempted) ? formState.fieldErrors.name : null,
    description: shouldShowError(touched.description, submitAttempted) ? formState.fieldErrors.description : null,
    imageUrl: shouldShowError(touched.imageUrl, submitAttempted) ? formState.fieldErrors.imageUrl : null,
    extraRoyaltyBps: submitAttempted ? formState.fieldErrors.extraRoyaltyBps : null,
  }

  return (
    <PageContainer size="sm" className="space-y-6">
      <SectionHeader
        label="Collection"
        title="Create Collection"
        subtitle="Mint a tradable Collection right from your wallet, then land directly on the mirrored detail page."
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label className="page-kicker text-muted">Collection Name *</label>
          <Input
            value={form.name}
            placeholder="e.g. Signal Founders Pass"
            className={visibleErrors.name ? 'border-danger/60 focus:border-danger' : undefined}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            onBlur={() => setTouched((current) => ({ ...current, name: true }))}
          />
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className={visibleErrors.name ? 'text-danger' : 'text-muted'}>
              {visibleErrors.name ?? 'Shown on market cards and the collection detail hero.'}
            </span>
            <span className={formState.byteCounts.name > 256 ? 'text-danger' : 'text-muted'}>
              {formState.byteCounts.name}/256 bytes
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="page-kicker text-muted">Description *</label>
          <Textarea
            value={form.description}
            placeholder="What does this Collection represent, and why should buyers care about the royalty stream?"
            className={visibleErrors.description ? 'border-danger/60 focus:border-danger' : undefined}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            onBlur={() => setTouched((current) => ({ ...current, description: true }))}
          />
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className={visibleErrors.description ? 'text-danger' : 'text-muted'}>
              {visibleErrors.description ?? 'Keep it concise enough to stay legible on chain and in the market UI.'}
            </span>
            <span className={formState.byteCounts.description > 4096 ? 'text-danger' : 'text-muted'}>
              {formState.byteCounts.description}/4096 bytes
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="page-kicker text-muted">Cover Image *</label>
          {!imageFile ? (
            <UploadZone
              icon="🖼"
              label="Click to upload cover image"
              sublabel="PNG, JPEG, WebP, GIF · Max 2 MB"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onFileSelect={handleImageSelect}
            />
          ) : (
            <div className="card flex items-center gap-4 border-success/40 bg-success/10 px-5 py-4">
              {imagePreviewUrl && (
                <img
                  src={imagePreviewUrl}
                  alt="Cover preview"
                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold text-foreground">{imageFile.name}</div>
                <div className="text-sm text-muted">
                  {(imageFile.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <button
                type="button"
                onClick={handleImageClear}
                className="shrink-0 text-sm text-muted transition-colors hover:text-foreground"
              >
                Replace
              </button>
            </div>
          )}
          {!imageFile && visibleErrors.imageUrl && (
            <p className="text-xs text-danger">{visibleErrors.imageUrl}</p>
          )}
        </div>

        <div className="space-y-2">
          <label className="page-kicker text-muted">Royalty on Secondary Resales</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
            {royaltyOptions.map((option) => {
              const selected = form.extraRoyaltyBps === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, extraRoyaltyBps: option.value }))}
                  className={`min-w-0 rounded-xl border px-3 py-3 text-left transition sm:px-4 sm:py-4 ${selected ? 'border-purple bg-purple/10' : 'border-border bg-white/[0.03] hover:border-purple/55'}`}
                >
                  <div className="truncate font-display text-base font-bold tracking-[-0.03em] text-foreground lg:text-lg">{option.label}</div>
                  <div className="mt-1 text-xs leading-5 text-muted">{option.desc}</div>
                </button>
              )
            })}
          </div>
          {visibleErrors.extraRoyaltyBps && (
            <p className="text-xs text-danger">{visibleErrors.extraRoyaltyBps}</p>
          )}
        </div>

        <div className="card flex flex-col items-start gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-base font-semibold text-foreground">Tradable collection right</div>
            <div className="mt-1 text-sm leading-6 text-muted">
              Leave this on to allow the Collection right itself to be listed and transferred later.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setForm((current) => ({ ...current, tradeable: !current.tradeable }))}
            className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${form.tradeable ? 'bg-[linear-gradient(135deg,var(--purple),var(--purple-deep))]' : 'bg-muted/30'}`}
            aria-pressed={form.tradeable}
            aria-label="Toggle whether the Collection right is tradeable"
          >
            <span className={`absolute left-0 top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${form.tradeable ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>

        {(statusCopy[createStatus] || txDigest) && (
          <div className="rounded-xl border border-border bg-card2 px-4 py-3 text-sm text-muted">
            {statusCopy[createStatus] && <p>{statusCopy[createStatus]}</p>}
            {txDigest && (
              <p className="mt-2 text-xs">
                Tx digest: <span className="font-mono text-foreground">{txDigest.slice(0, 16)}...</span>
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!isReady || isSubmitting}
          className={`${buttonStyles({ variant: 'primary', size: 'lg', full: true })} disabled:pointer-events-none disabled:opacity-40`}
        >
          {createStatus === 'building' && 'Preparing...'}
          {createStatus === 'signing' && 'Signing...'}
          {createStatus === 'syncing' && 'Syncing...'}
          {(createStatus === 'idle' || createStatus === 'done' || createStatus === 'error') && 'Create Collection'}
        </button>
      </form>
    </PageContainer>
  )
}
