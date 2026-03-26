'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@web/components/auth-provider'
import {
  clearSoulPublishDraft,
  draftHasOnChainProgress,
  patchSoulPublishDraft,
  readSoulPublishDraft,
  syncSoulPublishDraftForSubmit,
  type SoulPublishDraft,
  writeSoulPublishDraft,
} from '@web/lib/souls/publish-draft'
import { parseSubscriptionPeriodDaysToMs, parseUsdPriceToAtomic } from '@web/lib/souls/pricing-input'
import { usePrivySuiSign } from '@web/lib/souls/use-privy-sui'
import { buildCreateSeriesTx, buildCreatePricingPlanTx, buildPublishReleaseTx } from '@web/lib/souls/tx-builder'
import {
  FILE_TOO_LARGE_ERROR,
  JSON_METADATA_TOO_LARGE_ERROR,
  PUBLIC_UPLOAD_ERROR,
  validateSoulUploadFile,
} from '@web/lib/souls/upload-validation'
import {
  getSoulPublishPricingState,
  getVisibleSoulPublishPricingErrors,
} from '@web/lib/souls/publish-ui'

const CATEGORIES = ['Trading', 'Research', 'Social', 'DeFi', 'NFT', 'Infrastructure', 'Other']
const PREVIEW_FILE_VALIDATION_ERRORS = new Set([
  FILE_TOO_LARGE_ERROR,
  JSON_METADATA_TOO_LARGE_ERROR,
  PUBLIC_UPLOAD_ERROR,
])
const EMPTY_PRICING_TOUCHED_STATE = {
  oneTimePrice: false,
  subPrice: false,
  subPeriodDays: false,
}

function findCreatedObjectId(
  result: { objectChanges?: Array<{ type: string; objectType?: string; objectId?: string }> },
  typeSuffix: string,
): string | null {
  const obj = result.objectChanges?.find(
    (c) => c.type === 'created' && c.objectType?.includes(typeSuffix),
  )
  return obj?.objectId ?? null
}

function getPreviewFileCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

export default function PublishSoulPage() {
  const router = useRouter()
  const { user, loading: authLoading, getAuthHeaders } = useAuth()
  const { suiWallet, signAndExecute } = usePrivySuiSign()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [tags, setTags] = useState('')
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [bundleFile, setBundleFile] = useState<File | null>(null)
  const [releaseVersion, setReleaseVersion] = useState('1.0.0')
  const [pricingType, setPricingType] = useState<'onetime' | 'subscription' | 'both'>('onetime')
  const [oneTimePrice, setOneTimePrice] = useState('')
  const [subPrice, setSubPrice] = useState('')
  const [subPeriodDays, setSubPeriodDays] = useState('30')
  const [pricingTouched, setPricingTouched] = useState(EMPTY_PRICING_TOUCHED_STATE)
  const [pricingSubmitAttempted, setPricingSubmitAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [txDigest, setTxDigest] = useState('')
  const [uploadedPreview, setUploadedPreview] = useState<{ fileKey: string | null; blobId: string } | null>(null)
  const [publishDraft, setPublishDraft] = useState<SoulPublishDraft | null>(null)
  const [draftHydratedForWallet, setDraftHydratedForWallet] = useState<string | null>(null)
  const submitInFlightRef = useRef(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login')
    }
  }, [authLoading, router, user])

  useEffect(() => {
    if (!suiWallet?.address || draftHydratedForWallet === suiWallet.address || typeof window === 'undefined') {
      return
    }

    setDraftHydratedForWallet(suiWallet.address)

    const restoredDraft = readSoulPublishDraft(window.localStorage, suiWallet.address)
    if (!restoredDraft) {
      setPublishDraft(null)
      return
    }

    setPublishDraft(restoredDraft)
    setName(restoredDraft.name)
    setDescription(restoredDraft.description)
    setCategory(restoredDraft.category)
    setTags(restoredDraft.tags.join(', '))
    setPricingType(restoredDraft.pricingType)
    setOneTimePrice(restoredDraft.oneTimePrice)
    setSubPrice(restoredDraft.subPrice)
    setSubPeriodDays(restoredDraft.subPeriodDays)
    setPricingTouched(EMPTY_PRICING_TOUCHED_STATE)
    setPricingSubmitAttempted(false)
    setPreviewFile(null)
    setUploadedPreview(
      restoredDraft.previewBlobId
        ? { fileKey: restoredDraft.previewFileKey, blobId: restoredDraft.previewBlobId }
        : null,
    )
    setError(null)
    setStatus(
      draftHasOnChainProgress(restoredDraft)
        ? 'Recovered incomplete publish draft. Retry will continue from the saved on-chain step.'
        : 'Recovered incomplete publish draft.',
    )
  }, [draftHydratedForWallet, suiWallet?.address])

  if (authLoading) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div
          role="status"
          aria-live="polite"
          className="text-center py-12"
          style={{ color: 'var(--text-muted)' }}
        >
          Loading...
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="glass-card p-6 space-y-4">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Soul Created</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Soul was created on-chain and mirrored to the database successfully.
          </p>
          <p className="text-xs font-mono break-all" style={{ color: 'var(--text-muted)' }}>
            Tx: {txDigest}
          </p>
          <Link href="/souls" className="btn btn-primary inline-flex">Back to Souls</Link>
        </div>
      </div>
    )
  }

  async function uploadPreviewFile(file: File, headers: Record<string, string>) {
    const form = new FormData()
    form.append('file', file)
    form.append('type', 'public')
    const res = await fetch('/api/souls/upload', { method: 'POST', headers, body: form })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `Upload failed (${res.status})`)
    }
    return res.json() as Promise<{ blobId: string }>
  }

  function clearPreviewValidationError() {
    setError((current) => (current && PREVIEW_FILE_VALIDATION_ERRORS.has(current) ? null : current))
  }

  function handlePreviewFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    if (!nextFile) {
      setPreviewFile(null)
      clearPreviewValidationError()
      return
    }

    const validationError = validateSoulUploadFile(nextFile, 'public')
    if (validationError) {
      event.target.value = ''
      setError(validationError)
      return
    }

    setPreviewFile(nextFile)
    clearPreviewValidationError()
  }

  function persistDraft(nextDraft: SoulPublishDraft | null, walletAddressOverride?: string) {
    setPublishDraft(nextDraft)

    if (typeof window === 'undefined') {
      return
    }

    if (nextDraft) {
      writeSoulPublishDraft(window.localStorage, nextDraft)
      return
    }

    clearSoulPublishDraft(
      window.localStorage,
      walletAddressOverride ?? publishDraft?.walletAddress ?? suiWallet?.address ?? draftHydratedForWallet ?? undefined,
    )
  }

  function resetFormForNewPublish() {
    setName('')
    setDescription('')
    setCategory(CATEGORIES[0])
    setTags('')
    setPreviewFile(null)
    setPricingType('onetime')
    setOneTimePrice('')
    setSubPrice('')
    setSubPeriodDays('30')
    setPricingTouched(EMPTY_PRICING_TOUCHED_STATE)
    setPricingSubmitAttempted(false)
    setUploadedPreview(null)
    setPublishDraft(null)
    setStatus('')
    setError(null)
  }

  function markPricingFieldTouched(field: keyof typeof EMPTY_PRICING_TOUCHED_STATE) {
    setPricingTouched((current) => (
      current[field]
        ? current
        : { ...current, [field]: true }
    ))
  }

  function discardRecoveredDraft() {
    persistDraft(null)
    resetFormForNewPublish()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPricingSubmitAttempted(true)
    if (!suiWallet) {
      setError('No Sui wallet found in your Privy account')
      return
    }

    let currentDraft = publishDraft
    const hasRecoveredOnChainProgress = draftHasOnChainProgress(currentDraft)
    const effectivePricingType = currentDraft?.pricingType ?? pricingType
    const hasOnetime = effectivePricingType === 'onetime' || effectivePricingType === 'both'
    const hasSub = effectivePricingType === 'subscription' || effectivePricingType === 'both'
    const effectiveOneTimePrice = hasRecoveredOnChainProgress ? (currentDraft?.oneTimePrice ?? oneTimePrice) : oneTimePrice
    const effectiveSubPrice = hasRecoveredOnChainProgress ? (currentDraft?.subPrice ?? subPrice) : subPrice
    const effectiveSubPeriodDays = hasRecoveredOnChainProgress ? (currentDraft?.subPeriodDays ?? subPeriodDays) : subPeriodDays
    const oneTimeAtomic = hasOnetime ? parseUsdPriceToAtomic(effectiveOneTimePrice) : null
    if (hasOnetime && oneTimeAtomic === null) {
      setError('One-time price must be a positive USD amount with at most 6 decimal places')
      return
    }

    const subAtomic = hasSub ? parseUsdPriceToAtomic(effectiveSubPrice) : null
    if (hasSub && subAtomic === null) {
      setError('Subscription price must be a positive USD amount with at most 6 decimal places')
      return
    }

    const subscriptionPeriodMs = hasSub ? parseSubscriptionPeriodDaysToMs(effectiveSubPeriodDays) : null
    if (hasSub && subscriptionPeriodMs === null) {
      setError('Subscription period must be a whole number of days greater than zero')
      return
    }

    if (submitInFlightRef.current) {
      return
    }

    setError(null)
    submitInFlightRef.current = true
    setSubmitting(true)

    const draftWalletAddress = currentDraft?.walletAddress ?? suiWallet.address

    try {
      const headers = await getAuthHeaders()
      const tagList = tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      const submitDraft = syncSoulPublishDraftForSubmit(currentDraft, {
        walletAddress: suiWallet.address,
        name: name.trim(),
        description: description.trim(),
        category,
        tags: tagList,
        pricingType,
        oneTimePrice,
        subPrice,
        subPeriodDays,
      })
      if (submitDraft !== currentDraft) {
        currentDraft = submitDraft
        persistDraft(currentDraft)
      }

      let previewBlobId = currentDraft.previewBlobId
      if (previewFile) {
        const previewFileKey = getPreviewFileCacheKey(previewFile)
        if (uploadedPreview?.fileKey === previewFileKey) {
          previewBlobId = uploadedPreview.blobId
        } else {
          setStatus('Uploading preview image...')
          const { blobId } = await uploadPreviewFile(previewFile, headers)
          setUploadedPreview({ fileKey: previewFileKey, blobId })
          previewBlobId = blobId
          currentDraft = patchSoulPublishDraft(currentDraft, {
            previewBlobId: blobId,
            previewFileKey: previewFileKey,
          })
          persistDraft(currentDraft)
        }
      }

      const previewBlobIds = previewBlobId ? [previewBlobId] : []

      if (!currentDraft.seriesId || !currentDraft.authorCapId || !currentDraft.createTxDigest) {
        setStatus('Creating Soul on-chain...')
        const createTx = buildCreateSeriesTx({
          name: currentDraft.name.trim(),
          description: currentDraft.description.trim(),
          category: currentDraft.category,
          tags: currentDraft.tags,
          previewImages: previewBlobIds,
        })
        const createResult = await signAndExecute(createTx)

        const seriesId = findCreatedObjectId(createResult, '::series::SoulSeries')
        const authorCapId = findCreatedObjectId(createResult, '::series::AuthorCap')
        if (!seriesId || !authorCapId) {
          throw new Error('Failed to find created SoulSeries or AuthorCap in TX result')
        }

        currentDraft = patchSoulPublishDraft(currentDraft, {
          createTxDigest: createResult.digest,
          seriesId,
          authorCapId,
        })
        persistDraft(currentDraft)
      }

      const createTxDigest = currentDraft.createTxDigest
      const seriesId = currentDraft.seriesId
      const authorCapId = currentDraft.authorCapId
      if (!createTxDigest || !seriesId || !authorCapId) {
        throw new Error('Publish draft is missing required on-chain identifiers')
      }

      if (hasOnetime && (!currentDraft.oneTimePlanId || !currentDraft.oneTimePlanTxDigest)) {
        setStatus('Creating one-time pricing plan...')
        const planTx = buildCreatePricingPlanTx({
          authorCapId,
          seriesId,
          planType: 0,
          priceUsdc: oneTimeAtomic!,
          periodMs: 0n,
        })
        const planResult = await signAndExecute(planTx)
        const oneTimePlanId = findCreatedObjectId(planResult, '::purchase::PricingPlan')
        if (!oneTimePlanId) {
          throw new Error('Failed to find created one-time pricing plan in TX result')
        }

        currentDraft = patchSoulPublishDraft(currentDraft, {
          oneTimePlanId,
          oneTimePlanTxDigest: planResult.digest,
        })
        persistDraft(currentDraft)
      }

      if (hasSub && (!currentDraft.subPlanId || !currentDraft.subPlanTxDigest)) {
        setStatus('Creating subscription pricing plan...')
        const planTx = buildCreatePricingPlanTx({
          authorCapId,
          seriesId,
          planType: 1,
          priceUsdc: subAtomic!,
          periodMs: subscriptionPeriodMs!,
        })
        const planResult = await signAndExecute(planTx)
        const subPlanId = findCreatedObjectId(planResult, '::purchase::PricingPlan')
        if (!subPlanId) {
          throw new Error('Failed to find created subscription pricing plan in TX result')
        }

        currentDraft = patchSoulPublishDraft(currentDraft, {
          subPlanId,
          subPlanTxDigest: planResult.digest,
        })
        persistDraft(currentDraft)
      }

      if (bundleFile && !currentDraft.releaseId && !currentDraft.releaseTxDigest) {
        setStatus('Uploading Soul bundle...')
        const uploadForm = new FormData()
        uploadForm.append('file', bundleFile)
        uploadForm.append('type', 'encrypted')
        const uploadRes = await fetch('/api/souls/upload', { method: 'POST', headers, body: uploadForm })
        if (!uploadRes.ok) {
          const data = await uploadRes.json().catch(() => ({}))
          throw new Error(data.error || 'Bundle upload failed')
        }
        const { blobId: encryptedBlobId, contentHash, sealDekEnvelope } = await uploadRes.json()

        setStatus('Creating release on-chain...')
        const contentHashBytes = new Uint8Array(
          contentHash.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)),
        )
        const releaseTx = buildPublishReleaseTx({
          authorCapId,
          seriesId,
          version: releaseVersion.trim() || '1.0.0',
          encryptedBlobId,
          publicMetadataId: encryptedBlobId,
          contentHash: contentHashBytes,
        })
        const releaseResult = await signAndExecute(releaseTx)
        const releaseId = findCreatedObjectId(releaseResult, '::series::SoulRelease')
        if (!releaseId) {
          throw new Error('Failed to find created SoulRelease in TX result')
        }

        currentDraft = patchSoulPublishDraft(currentDraft, {
          releaseId,
          releaseTxDigest: releaseResult.digest,
          sealDekEnvelope: sealDekEnvelope ?? null,
        })
        persistDraft(currentDraft)
      }

      if (!currentDraft.dbMirroredAt) {
        setStatus('Saving to database...')
        const publishRes = await fetch('/api/souls/publish', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txDigest: createTxDigest,
            seriesOnChainId: seriesId,
            releaseOnChainId: currentDraft.releaseId,
            releaseTxDigest: currentDraft.releaseTxDigest,
            oneTimePlanOnChainId: currentDraft.oneTimePlanId,
            oneTimePlanTxDigest: currentDraft.oneTimePlanTxDigest,
            subPlanOnChainId: currentDraft.subPlanId,
            subPlanTxDigest: currentDraft.subPlanTxDigest,
            ...(currentDraft.sealDekEnvelope ? { sealDekEnvelope: currentDraft.sealDekEnvelope } : {}),
          }),
        })
        if (!publishRes.ok) {
          const data = await publishRes.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to mirror Soul in database')
        }

        currentDraft = patchSoulPublishDraft(currentDraft, {
          dbMirroredAt: new Date().toISOString(),
        })
        persistDraft(currentDraft)
      }

      setTxDigest(createTxDigest)
      setDone(true)
      persistDraft(null, draftWalletAddress)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Publish failed'
      setError(
        currentDraft && draftHasOnChainProgress(currentDraft)
          ? `${message} Retry will continue from the last saved on-chain step.`
          : message,
      )
    } finally {
      submitInFlightRef.current = false
      setSubmitting(false)
      setStatus('')
    }
  }

  const hasRecoverableDraft = draftHasOnChainProgress(publishDraft)
  const pricingState = getSoulPublishPricingState({
    pricingType,
    oneTimePrice,
    subPrice,
    subPeriodDays,
  })
  const visiblePricingErrors = getVisibleSoulPublishPricingErrors(pricingState, {
    submitAttempted: pricingSubmitAttempted,
    touched: pricingTouched,
  })
  const lockPublishConfig = submitting || hasRecoverableDraft
  // Allow bundle + version re-selection when resuming a draft that has series but no release yet
  const lockBundleInput = lockPublishConfig && !!(publishDraft?.releaseId)
  const isSubmitDisabled =
    submitting
    || !name.trim()
    || !suiWallet
    || !pricingState.isComplete

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="glass-card p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Publish Soul</h1>
          <Link href="/souls" className="text-sm" style={{ color: 'var(--text-muted)' }}>Cancel</Link>
        </div>

        {hasRecoverableDraft && (
          <div className="glass-card p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Recovered an incomplete publish draft. Retry will continue from the saved on-chain step, and the form stays locked to avoid drifting away from the already-created chain state.
            </p>
            <button type="button" className="btn" onClick={discardRecoveredDraft} disabled={submitting}>
              Discard Recovered Draft
            </button>
          </div>
        )}

        {!suiWallet && (
          <p className="text-sm" style={{ color: 'var(--color-error, #f87171)' }}>
            No Sui wallet found in your Privy account. Please contact support.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="soul-name" className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Name</label>
            <input id="soul-name" type="text" className="input-dark w-full" placeholder="Soul name" value={name} onChange={(e) => setName(e.target.value)} required disabled={lockPublishConfig} maxLength={100} />
          </div>

          <div className="space-y-1">
            <label htmlFor="soul-description" className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Description</label>
            <textarea id="soul-description" className="input-dark w-full resize-none" placeholder="Describe this Soul..." value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={lockPublishConfig} maxLength={1000} />
          </div>

          <div className="space-y-1">
            <label htmlFor="soul-category" className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Category</label>
            <select id="soul-category" className="input-dark w-full" value={category} onChange={(e) => setCategory(e.target.value)} disabled={lockPublishConfig}>
              {CATEGORIES.map((cat) => (<option key={cat} value={cat}>{cat}</option>))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="soul-tags" className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Tags <span style={{ fontWeight: 400 }}>(comma-separated)</span></label>
            <input id="soul-tags" type="text" className="input-dark w-full" placeholder="e.g. ai, trading, signals" value={tags} onChange={(e) => setTags(e.target.value)} disabled={lockPublishConfig} />
          </div>

          <div className="space-y-1">
            <label htmlFor="soul-preview-image" className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Preview Image <span style={{ fontWeight: 400 }}>(optional)</span></label>
            <input
              id="soul-preview-image"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="input-file-prominent w-full text-xs"
              onChange={handlePreviewFileChange}
              disabled={lockPublishConfig}
            />
            <p className="text-xs" style={{ color: previewFile ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
              {previewFile ? `Selected: ${previewFile.name}` : uploadedPreview?.blobId ? 'Recovered preview image is already cached for this draft.' : 'Choose a JPEG, PNG, WebP, or GIF preview image.'}
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="soul-bundle" className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Soul Bundle <span style={{ fontWeight: 400 }}>(the content file buyers will access)</span></label>
            <input
              id="soul-bundle"
              type="file"
              className="input-file-prominent w-full text-xs"
              onChange={(e) => setBundleFile(e.target.files?.[0] ?? null)}
              disabled={lockBundleInput}
            />
            <p className="text-xs" style={{ color: bundleFile ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
              {bundleFile ? `Selected: ${bundleFile.name}` : 'Choose the encrypted bundle file buyers will unlock after purchase.'}
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="soul-version" className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Version</label>
            <input id="soul-version" type="text" className="input-dark w-full" placeholder="1.0.0" value={releaseVersion} onChange={(e) => setReleaseVersion(e.target.value)} disabled={lockBundleInput} maxLength={32} />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Pricing</label>
            <div className="flex gap-2">
              {(['onetime', 'subscription', 'both'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setPricingType(type)}
                  disabled={lockPublishConfig}
                  className={`filter-pill text-xs ${pricingType === type ? 'filter-pill-active' : ''}`}
                  aria-pressed={pricingType === type}
                >
                  {type === 'onetime' ? 'One-time' : type === 'subscription' ? 'Subscription' : 'Both'}
                </button>
              ))}
            </div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {pricingState.helperText}
            </p>
          </div>

          {(pricingType === 'onetime' || pricingType === 'both') && (
            <div className="space-y-1">
              <label htmlFor="soul-one-time-price" className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                One-time Price (USD) <span style={{ color: 'var(--accent-rose)' }}>Required</span>
              </label>
              <input
                id="soul-one-time-price"
                type="number"
                step="0.01"
                min="0.01"
                className="input-dark w-full"
                placeholder="10.00"
                value={oneTimePrice}
                onChange={(e) => {
                  markPricingFieldTouched('oneTimePrice')
                  setOneTimePrice(e.target.value)
                }}
                disabled={lockPublishConfig}
              />
              {visiblePricingErrors.oneTimePrice && (
                <p className="text-xs" style={{ color: 'var(--color-error, #f87171)' }}>
                  {visiblePricingErrors.oneTimePrice}
                </p>
              )}
            </div>
          )}

          {(pricingType === 'subscription' || pricingType === 'both') && (
            <>
              <div className="space-y-1">
                <label htmlFor="soul-subscription-price" className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  Subscription Price (USD / period) <span style={{ color: 'var(--accent-rose)' }}>Required</span>
                </label>
                <input
                  id="soul-subscription-price"
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="input-dark w-full"
                  placeholder="5.00"
                  value={subPrice}
                  onChange={(e) => {
                    markPricingFieldTouched('subPrice')
                    setSubPrice(e.target.value)
                  }}
                  disabled={lockPublishConfig}
                />
                {visiblePricingErrors.subPrice && (
                  <p className="text-xs" style={{ color: 'var(--color-error, #f87171)' }}>
                    {visiblePricingErrors.subPrice}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label htmlFor="soul-subscription-period-days" className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  Period (days) <span style={{ color: 'var(--accent-rose)' }}>Required</span>
                </label>
                <input
                  id="soul-subscription-period-days"
                  type="number"
                  min="1"
                  className="input-dark w-full"
                  value={subPeriodDays}
                  onChange={(e) => {
                    markPricingFieldTouched('subPeriodDays')
                    setSubPeriodDays(e.target.value)
                  }}
                  disabled={lockPublishConfig}
                />
                {visiblePricingErrors.subPeriodDays && (
                  <p className="text-xs" style={{ color: 'var(--color-error, #f87171)' }}>
                    {visiblePricingErrors.subPeriodDays}
                  </p>
                )}
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm" style={{ color: 'var(--color-error, #f87171)' }}>{error}</p>
          )}

          <div aria-live="polite" className="sr-only">
            {submitting ? (status || 'Publishing...') : ''}
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={isSubmitDisabled}>
            {submitting ? (status || 'Publishing...') : 'Create Soul'}
          </button>
        </form>
      </div>
    </div>
  )
}
