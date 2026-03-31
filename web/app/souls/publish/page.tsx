'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@web/components/auth-provider'
import { UploadWalrus, type WalrusUploadResult } from '@web/components/souls/upload-walrus'
import { PublishStepper } from '@web/components/souls/publish-stepper'
import { UploadZone } from '@web/components/souls/upload-zone'
import { buildMintOnlySoulTx } from '@web/lib/souls/tx-builder'
import { usePrivySuiSign } from '@web/lib/souls/use-privy-sui'
import { getBlobUrl } from '@web/lib/services/walrus'
import {
  INCOMPLETE_PUBLISH_PROGRESS_ERROR,
} from '@web/lib/souls/publish-ui'
import {
  clearSoulPublishDraft,
  draftHasOnChainProgress,
  patchSoulPublishDraft,
  readSoulPublishDraft,
  readSoulPublishRetrySnapshot,
  syncSoulPublishDraftForSubmit,
  writeSoulPublishDraft,
} from '@web/lib/souls/publish-draft'
import {
  getSoulPublishCompatibilityErrorMessage,
  getSoulPublishPackageCompatibility,
} from '@web/lib/souls/package-compatibility'
import { mirrorRouteRequest, formatMirrorSyncError } from '@web/lib/souls/mirror-sync'

type CreatedObjectChange = {
  type?: string
  objectType?: string
  objectId?: string
}

type PreparedContentUpload = WalrusUploadResult & {
  fileKey: string | null
}

type ResolvedPublishPersonalKiosk = {
  currentKioskId: string
  currentKioskCapOnChainId: string
} | null

const MAX_SOUL_NAME_LENGTH = 100
const MAX_SOUL_DESCRIPTION_LENGTH = 1_000
const MAX_SOUL_CATEGORY_LENGTH = 64
const MAX_SOUL_TAGS_INPUT_LENGTH = 700
const MAX_SOUL_README_LENGTH = 10_000
const DRAFT_AUTOSAVE_DEBOUNCE_MS = 300

function splitTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

function findCreatedSoulObjectId(result: { objectChanges?: CreatedObjectChange[] | null }) {
  return result.objectChanges?.find((change) =>
    change.type === 'created'
    && typeof change.objectId === 'string'
    && typeof change.objectType === 'string'
    && change.objectType.includes('::soul::Soul')
  )?.objectId ?? null
}

function getLocalFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`
}

async function resolvePublishPersonalKiosk(headers: Record<string, string>): Promise<ResolvedPublishPersonalKiosk> {
  const response = await fetch('/api/souls/personal-kiosk', { headers })
  if (response.status === 404) {
    return null
  }

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to resolve Soul personal kiosk right now')
  }
  if (
    typeof payload?.currentKioskId !== 'string'
    || typeof payload?.currentKioskCapOnChainId !== 'string'
  ) {
    throw new Error('Soul personal kiosk response was incomplete')
  }

  return {
    currentKioskId: payload.currentKioskId,
    currentKioskCapOnChainId: payload.currentKioskCapOnChainId,
  }
}

// ---------------------------------------------------------------------------
// Step validation helpers
// ---------------------------------------------------------------------------

function isStep1Complete(name: string, description: string, category: string) {
  return name.trim().length > 0 && description.trim().length > 0 && category.trim().length > 0
}

function isStep2Complete(
  previewUpload: WalrusUploadResult | null,
  contentFile: File | null,
  preparedContentUpload: PreparedContentUpload | null,
) {
  return previewUpload != null && (contentFile != null || preparedContentUpload != null)
}

export default function PublishSoulPage() {
  const router = useRouter()
  const { user, getAuthHeaders } = useAuth()
  const { signAndExecute } = usePrivySuiSign()

  // -------------------------------------------------------------------------
  // Form state — identical to previous implementation
  // -------------------------------------------------------------------------
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [readme, setReadme] = useState('')
  const [previewUpload, setPreviewUpload] = useState<WalrusUploadResult | null>(null)
  const [contentFile, setContentFile] = useState<File | null>(null)
  const [preparedContentUpload, setPreparedContentUpload] = useState<PreparedContentUpload | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const draftAutosaveTimeoutRef = useRef<number | null>(null)

  // -------------------------------------------------------------------------
  // Step state
  // -------------------------------------------------------------------------
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1)

  const tags = useMemo(() => splitTags(tagsInput), [tagsInput])

  const step1Complete = isStep1Complete(name, description, category)
  const step2Complete = isStep2Complete(previewUpload, contentFile, preparedContentUpload)

  const completedSteps = useMemo(() => {
    const s = new Set<number>()
    if (step1Complete && currentStep > 1) s.add(1)
    if (step2Complete && currentStep > 2) s.add(2)
    return s
  }, [step1Complete, step2Complete, currentStep])

  // -------------------------------------------------------------------------
  // Draft recovery — identical to previous implementation
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined' || !user?.primarySuiAddress) {
      return
    }

    const draft = readSoulPublishDraft(window.localStorage, user.primarySuiAddress)
    if (!draft) {
      return
    }

    setName(draft.name)
    setDescription(draft.description)
    setCategory(draft.category)
    setTagsInput(draft.tags.join(', '))
    setReadme(draft.readme)

    let restoredPreviewUpload: WalrusUploadResult | null = null
    if (draft.previewBlobId) {
      restoredPreviewUpload = {
        blobId: draft.previewBlobId,
        blobObjectId: null,
        contentHash: '',
      }
      setPreviewUpload(restoredPreviewUpload)
    }

    let restoredContentUpload: PreparedContentUpload | null = null
    if (draft.contentBlobId && draft.contentBlobObjectId && draft.sealDekEnvelope) {
      restoredContentUpload = {
        blobId: draft.contentBlobId,
        blobObjectId: draft.contentBlobObjectId,
        contentHash: '',
        sealDekEnvelope: draft.sealDekEnvelope,
        fileKey: null,
      }
      setPreparedContentUpload(restoredContentUpload)
    }

    // Advance to review step when draft restores a fully complete form
    const draftStep1Complete = isStep1Complete(draft.name, draft.description, draft.category)
    const draftStep2Complete = isStep2Complete(restoredPreviewUpload, null, restoredContentUpload)
    if (draftStep1Complete && draftStep2Complete) {
      setCurrentStep(3)
    } else if (draftStep1Complete) {
      setCurrentStep(2)
    }
  }, [user?.primarySuiAddress])

  // -------------------------------------------------------------------------
  // Draft autosave — identical to previous implementation
  // -------------------------------------------------------------------------
  function clearDraftAutosaveTimeout() {
    if (typeof window === 'undefined' || draftAutosaveTimeoutRef.current == null) {
      return
    }
    window.clearTimeout(draftAutosaveTimeoutRef.current)
    draftAutosaveTimeoutRef.current = null
  }

  function persistEditableDraft() {
    if (typeof window === 'undefined' || !user?.primarySuiAddress) {
      return
    }

    const baseDraft = syncSoulPublishDraftForSubmit(
      readSoulPublishDraft(window.localStorage, user.primarySuiAddress),
      {
        walletAddress: user.primarySuiAddress,
        name,
        description,
        category,
        tags,
        imageUrl: previewUpload ? getBlobUrl(previewUpload.blobId) : '',
        listForSale: false,
        priceInput: '',
        creatorRoyaltyBps: '0',
        readme,
      },
    )

    if (draftHasOnChainProgress(baseDraft)) {
      writeSoulPublishDraft(window.localStorage, baseDraft)
      return
    }

    writeSoulPublishDraft(window.localStorage, patchSoulPublishDraft(baseDraft, {
      previewBlobId: previewUpload?.blobId ?? null,
      contentBlobId: null,
      contentBlobObjectId: null,
      metadataRef: null,
      sealDekEnvelope: null,
    }))
  }

  useEffect(() => {
    if (typeof window === 'undefined' || !user?.primarySuiAddress) {
      return
    }

    clearDraftAutosaveTimeout()
    draftAutosaveTimeoutRef.current = window.setTimeout(() => {
      draftAutosaveTimeoutRef.current = null
      persistEditableDraft()
    }, DRAFT_AUTOSAVE_DEBOUNCE_MS)

    return () => {
      clearDraftAutosaveTimeout()
    }
  }, [
    user?.primarySuiAddress,
    name,
    description,
    category,
    tags,
    previewUpload,
    readme,
  ])

  useEffect(() => () => {
    clearDraftAutosaveTimeout()
  }, [])

  // -------------------------------------------------------------------------
  // Upload helpers — identical to previous implementation
  // -------------------------------------------------------------------------
  async function uploadMetadata(headers: Record<string, string>) {
    const payload = {
      category,
      tags,
      previewImages: previewUpload ? [previewUpload.blobId] : [],
      readme,
    }

    const file = new File([JSON.stringify(payload, null, 2)], 'metadata.json', { type: 'application/json' })
    const formData = new FormData()
    formData.append('file', file)
    formData.append('type', 'public')

    const response = await fetch('/api/souls/upload', {
      method: 'POST',
      headers,
      body: formData,
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to upload metadata')
    }
    return response.json() as Promise<{ blobId: string }>
  }

  async function uploadEncryptedContent(headers: Record<string, string>, file: File) {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('type', 'encrypted')

    const response = await fetch('/api/souls/upload', {
      method: 'POST',
      headers,
      body: formData,
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to prepare encrypted Soul content')
    }
    return response.json() as Promise<WalrusUploadResult>
  }

  function handleContentFileChange(file: File) {
    setContentFile(file)
    setPreparedContentUpload(null)
    if (error) {
      setError(null)
    }
  }

  // -------------------------------------------------------------------------
  // Submit handler — identical to previous implementation
  // -------------------------------------------------------------------------
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!user?.primarySuiAddress) {
      setError('Bind a Sui wallet first')
      return
    }
    if (!name.trim() || !description.trim() || !category.trim()) {
      setError('Fill in all required Soul fields')
      return
    }
    if (!previewUpload) {
      setError('Upload a preview image first')
      return
    }
    if (!contentFile && !preparedContentUpload) {
      setError('Choose the original content file first')
      return
    }

    setSubmitting(true)
    try {
      const compatibility = await getSoulPublishPackageCompatibility()
      if (compatibility && !compatibility.supportsFixedPricePublish) {
        throw new Error(getSoulPublishCompatibilityErrorMessage(compatibility.packageId, 'fixedPrice'))
      }

      clearDraftAutosaveTimeout()
      persistEditableDraft()

      const existingDraft = typeof window !== 'undefined'
        ? readSoulPublishDraft(window.localStorage, user.primarySuiAddress)
        : null
      if (existingDraft?.soulObjectId && existingDraft.publishTxDigest && draftHasOnChainProgress(existingDraft)) {
        const retrySnapshot = readSoulPublishRetrySnapshot(existingDraft)
        if (!retrySnapshot) {
          throw new Error(INCOMPLETE_PUBLISH_PROGRESS_ERROR)
        }
        await mirrorRouteRequest({
          input: '/api/souls/publish',
          init: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(await getAuthHeaders()),
            },
            body: JSON.stringify({
              txDigest: retrySnapshot.txDigest,
              soulOnChainId: retrySnapshot.soulObjectId,
              contentBlobId: retrySnapshot.contentBlobId,
              contentBlobObjectId: retrySnapshot.contentBlobObjectId,
              sealDekEnvelope: retrySnapshot.sealDekEnvelope,
              category: retrySnapshot.category,
              tags: retrySnapshot.tags,
              previewImages: retrySnapshot.previewImages,
              readme: retrySnapshot.readme,
            }),
          },
        })
        if (typeof window !== 'undefined') {
          clearSoulPublishDraft(window.localStorage, user.primarySuiAddress)
        }
        router.push(`/souls/${encodeURIComponent(retrySnapshot.soulObjectId)}`)
        return
      }

      const headers = await getAuthHeaders()
      const existingPersonalKiosk = await resolvePublishPersonalKiosk(headers)
      if (existingPersonalKiosk && compatibility && !compatibility.supportsPersonalKioskPublish) {
        throw new Error(getSoulPublishCompatibilityErrorMessage(compatibility.packageId, 'personalKiosk'))
      }
      const contentFileKey = contentFile ? getLocalFileKey(contentFile) : null
      let contentUpload = preparedContentUpload
      if (
        !contentUpload
        || (contentUpload.fileKey !== null && contentUpload.fileKey !== contentFileKey)
      ) {
        if (!contentFile) {
          throw new Error('Choose the original content file first')
        }
        contentUpload = {
          ...(await uploadEncryptedContent(headers, contentFile)),
          fileKey: contentFileKey,
        }
        setPreparedContentUpload(contentUpload)
      }
      if (!contentUpload.blobObjectId || !contentUpload.sealDekEnvelope) {
        throw new Error('Failed to prepare encrypted Soul content')
      }

      const metadata = await uploadMetadata(headers)
      const tx = buildMintOnlySoulTx({
        name: name.trim(),
        description: description.trim(),
        imageUrl: getBlobUrl(previewUpload.blobId),
        metadataRef: metadata.blobId,
        contentBlobObjectId: contentUpload.blobObjectId,
        currentKioskId: existingPersonalKiosk?.currentKioskId ?? null,
        currentKioskCapOnChainId: existingPersonalKiosk?.currentKioskCapOnChainId ?? null,
        category: category.trim(),
        tags,
        previewImages: [previewUpload.blobId],
        readme: readme.trim() || null,
        creatorRoyaltyBps: 0,
      })

      const result = await signAndExecute(tx)
      const soulObjectId = findCreatedSoulObjectId(result as { objectChanges?: CreatedObjectChange[] | null })
      if (!soulObjectId) {
        throw new Error('Transaction succeeded but no Soul object was created')
      }

      if (typeof window !== 'undefined') {
        const currentDraft = readSoulPublishDraft(window.localStorage, user.primarySuiAddress)
        if (currentDraft) {
          writeSoulPublishDraft(window.localStorage, patchSoulPublishDraft(currentDraft, {
            contentBlobId: contentUpload.blobId,
            contentBlobObjectId: contentUpload.blobObjectId,
            sealDekEnvelope: contentUpload.sealDekEnvelope ?? null,
            soulObjectId,
            publishTxDigest: result.digest,
          }))
        }
      }

      await mirrorRouteRequest({
        input: '/api/souls/publish',
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({
            txDigest: result.digest,
            soulOnChainId: soulObjectId,
            contentBlobId: contentUpload.blobId,
            contentBlobObjectId: contentUpload.blobObjectId,
            sealDekEnvelope: contentUpload.sealDekEnvelope,
            category: category.trim(),
            tags,
            previewImages: [previewUpload.blobId],
            readme: readme.trim() || null,
          }),
        },
      })

      if (typeof window !== 'undefined') {
        clearSoulPublishDraft(window.localStorage, user.primarySuiAddress)
      }

      router.push(`/souls/${encodeURIComponent(soulObjectId)}`)
    } catch (publishError) {
      setError(formatMirrorSyncError(publishError))
    } finally {
      setSubmitting(false)
    }
  }

  // -------------------------------------------------------------------------
  // Draft on-chain progress banner
  // -------------------------------------------------------------------------
  const existingDraftFromStorage =
    typeof window !== 'undefined' && user?.primarySuiAddress
      ? readSoulPublishDraft(window.localStorage, user.primarySuiAddress)
      : null
  const showResumeBanner = draftHasOnChainProgress(existingDraftFromStorage)

  function handleClearDraft() {
    if (typeof window !== 'undefined' && user?.primarySuiAddress) {
      clearSoulPublishDraft(window.localStorage, user.primarySuiAddress)
      setName('')
      setDescription('')
      setCategory('')
      setTagsInput('')
      setReadme('')
      setPreviewUpload(null)
      setContentFile(null)
      setPreparedContentUpload(null)
      setCurrentStep(1)
      setError(null)
    }
  }

  // -------------------------------------------------------------------------
  // Step navigation
  // -------------------------------------------------------------------------
  function goToStep1() { setCurrentStep(1) }
  function goToStep2() { setCurrentStep(2) }
  function goToStep3() { setCurrentStep(3) }

  function handleStep1Continue() {
    if (!step1Complete) {
      setError('Fill in Name, Description, and Category before continuing.')
      return
    }
    setError(null)
    goToStep2()
  }

  function handleStep2Continue() {
    if (!step2Complete) {
      setError('Upload a preview image and select a content file before continuing.')
      return
    }
    setError(null)
    goToStep3()
  }

  // Collapsed step summary text
  const step1Summary = [name, category, tags.join(', ')].filter(Boolean).join(' / ')
  const step2Summary = [
    previewUpload ? 'Preview uploaded' : null,
    contentFile || preparedContentUpload ? 'Content ready' : null,
  ].filter(Boolean).join(' — ')

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (!user) {
    return (
      <div className="min-h-screen">
        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          <Link
            href="/souls"
            className="inline-flex items-center gap-1 text-sm mb-6"
            style={{ color: 'var(--text-muted)' }}
          >
            <span aria-hidden="true">←</span> Back to Souls
          </Link>
          <div className="glass-panel p-12 flex flex-col items-center text-center gap-4">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
            </svg>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
              Sign in to publish
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Connect your account to create and mint Souls on the marketplace.
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Back link */}
        <Link
          href="/souls"
          className="inline-flex items-center gap-1 text-sm mb-6"
          style={{ color: 'var(--text-muted)' }}
        >
          <span aria-hidden="true">←</span> Back to Souls
        </Link>

        {/* Page title */}
        <div className="mb-6">
          <h1
            className="font-extrabold"
            style={{
              fontSize: '2.5rem',
              lineHeight: 1.1,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-display)',
            }}
          >
            Mint a Soul
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Create a one-of-one encrypted content bundle.
          </p>
        </div>

        {/* Step indicator */}
        <PublishStepper currentStep={currentStep} completedSteps={completedSteps} />

        {/* Draft resume banner */}
        {showResumeBanner && (
          <div
            className="glass-panel p-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            style={{ borderColor: 'var(--accent-amber)', background: 'var(--accent-amber-dim)' }}
          >
            <p className="text-sm font-medium" style={{ color: 'var(--accent-amber)' }}>
              You have a publish in progress. Resume or clear to start fresh.
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                className="btn btn-surface text-xs px-3 py-1.5"
                onClick={handleClearDraft}
              >
                Clear draft
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* ----------------------------------------------------------------
              STEP 1 — IDENTITY
          ---------------------------------------------------------------- */}
          {currentStep === 1 ? (
            <div className="glass-panel p-4 sm:p-6 flex flex-col gap-4">
              <h2
                className="text-sm font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-muted)' }}
              >
                Identity
              </h2>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Name
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={MAX_SOUL_NAME_LENGTH}
                  className="glass-panel px-3 py-3 bg-transparent outline-none"
                  placeholder="e.g. Alpha Research Bundle #1"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Description
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={MAX_SOUL_DESCRIPTION_LENGTH}
                  rows={4}
                  className="glass-panel px-3 py-3 bg-transparent outline-none"
                  placeholder="What does this Soul contain?"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    Category
                  </span>
                  <input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    maxLength={MAX_SOUL_CATEGORY_LENGTH}
                    className="glass-panel px-3 py-3 bg-transparent outline-none"
                    placeholder="e.g. DeFi Research"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    Tags
                  </span>
                  <input
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    maxLength={MAX_SOUL_TAGS_INPUT_LENGTH}
                    placeholder="alpha, research, macro"
                    className="glass-panel px-3 py-3 bg-transparent outline-none"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  README
                  <span className="ml-1 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                    optional
                  </span>
                </span>
                <textarea
                  value={readme}
                  onChange={(e) => setReadme(e.target.value)}
                  maxLength={MAX_SOUL_README_LENGTH}
                  rows={5}
                  className="glass-panel px-3 py-3 bg-transparent outline-none"
                  placeholder="Describe what buyers will get, how to use it, etc."
                />
              </label>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  className="btn btn-primary px-6 py-2.5 text-sm font-semibold"
                  onClick={handleStep1Continue}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : (
            /* Step 1 collapsed */
            <div
              className="glass-panel px-4 py-3 flex items-center justify-between gap-3"
              style={{ opacity: currentStep < 1 ? 0.5 : 1 }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                  Identity
                </span>
                {step1Summary ? (
                  <span
                    className="text-sm truncate"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {step1Summary}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="btn btn-surface text-xs px-3 py-1.5 flex-shrink-0"
                onClick={goToStep1}
              >
                Edit
              </button>
            </div>
          )}

          {/* ----------------------------------------------------------------
              STEP 2 — CONTENT
          ---------------------------------------------------------------- */}
          {currentStep === 2 ? (
            <div className="glass-panel p-4 sm:p-6 flex flex-col gap-4">
              <h2
                className="text-sm font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-muted)' }}
              >
                Content
              </h2>

              <div className="grid gap-4 md:grid-cols-2">
                {/* Preview image — UploadWalrus handles upload, UploadZone just shows state */}
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    Preview image
                  </span>
                  {previewUpload ? (
                    <UploadZone
                      type="preview"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      file={null}
                      uploadResult={previewUpload}
                      uploading={false}
                      disabled={submitting}
                      onFileSelect={() => {}}
                      onClear={() => setPreviewUpload(null)}
                    />
                  ) : (
                    <UploadWalrus
                      type="public"
                      label="Click or drag to upload"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onUpload={setPreviewUpload}
                    />
                  )}
                </div>

                {/* Content file */}
                <div className="flex flex-col gap-1">
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      Content file
                    </span>
                    <UploadZone
                      type="content"
                      file={contentFile}
                      uploadResult={preparedContentUpload ? { blobId: preparedContentUpload.blobId } : null}
                      uploading={false}
                      disabled={submitting}
                      onFileSelect={handleContentFileChange}
                      onClear={() => {
                        setContentFile(null)
                        setPreparedContentUpload(null)
                      }}
                    />
                  </label>
                  <span className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Encryption and upload happen automatically when you publish.
                  </span>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  className="btn btn-primary px-6 py-2.5 text-sm font-semibold"
                  onClick={handleStep2Continue}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : currentStep > 2 ? (
            /* Step 2 collapsed — only shown when past it */
            <div className="glass-panel px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                  Content
                </span>
                {step2Summary ? (
                  <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                    {step2Summary}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="btn btn-surface text-xs px-3 py-1.5 flex-shrink-0"
                onClick={goToStep2}
              >
                Edit
              </button>
            </div>
          ) : null}

          {/* ----------------------------------------------------------------
              STEP 3 — REVIEW
          ---------------------------------------------------------------- */}
          {currentStep === 3 && (
            <div className="glass-panel p-4 sm:p-6 flex flex-col gap-5">
              <h2
                className="text-sm font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-muted)' }}
              >
                Review
              </h2>

              {/* Mini preview */}
              <div className="flex gap-4 items-start">
                {previewUpload && (
                  <img
                    src={getBlobUrl(previewUpload.blobId)}
                    alt="Preview thumbnail"
                    className="rounded-lg flex-shrink-0"
                    style={{ width: '72px', height: '72px', objectFit: 'cover' }}
                  />
                )}
                <div className="flex flex-col gap-1 min-w-0">
                  <p className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
                    {name || '—'}
                  </p>
                  {category && (
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {category}
                    </p>
                  )}
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="badge"
                          style={{
                            background: 'var(--accent-cyan-dim)',
                            color: 'var(--accent-cyan)',
                            fontSize: '0.7rem',
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Content file summary */}
              {(contentFile || preparedContentUpload) && (
                <div
                  className="flex items-center gap-3 px-3 py-2 rounded-lg"
                  style={{ background: 'var(--accent-emerald-dim)' }}
                >
                  <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                    {contentFile?.name ?? 'Content staged for recovery'}
                  </span>
                  <span
                    className="badge flex-shrink-0"
                    style={{
                      background: 'var(--accent-emerald-dim)',
                      color: 'var(--accent-emerald)',
                    }}
                  >
                    Ready
                  </span>
                </div>
              )}

              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Your Soul will be minted into your kiosk. You can list it for sale from the detail page.
              </p>

              {error && (
                <p className="text-sm" style={{ color: 'var(--accent-rose)' }}>{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-4 rounded-xl font-semibold text-base"
                style={{
                  background: 'var(--accent-cyan)',
                  color: '#02131a',
                  opacity: submitting ? 0.7 : 1,
                  cursor: submitting ? 'default' : 'pointer',
                }}
              >
                {submitting ? 'Publishing…' : 'Publish Soul'}
              </button>
            </div>
          )}

          {/* Inline error for step 1/2 — shown below the active panel */}
          {currentStep !== 3 && error && (
            <p className="text-sm" style={{ color: 'var(--accent-rose)' }}>{error}</p>
          )}
        </form>
      </main>
    </div>
  )
}
