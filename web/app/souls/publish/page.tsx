'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@web/components/auth-provider'
import { UploadWalrus, type WalrusUploadResult } from '@web/components/souls/upload-walrus'
import { buildMintAndListSoulTx } from '@web/lib/souls/tx-builder'
import { usePrivySuiSign } from '@web/lib/souls/use-privy-sui'
import { getBlobUrl } from '@web/lib/services/walrus'
import { getSoulPublishPriceState, getVisibleSoulPublishPriceErrors } from '@web/lib/souls/publish-ui'
import { parseSuiPriceToMist } from '@web/lib/souls/pricing-input'
import {
  clearSoulPublishDraft,
  createSoulPublishDraft,
  draftHasOnChainProgress,
  patchSoulPublishDraft,
  readSoulPublishDraft,
  syncSoulPublishDraftForSubmit,
  writeSoulPublishDraft,
} from '@web/lib/souls/publish-draft'
import { mirrorRouteRequest, formatMirrorSyncError } from '@web/lib/souls/mirror-sync'

type CreatedObjectChange = {
  type?: string
  objectType?: string
  objectId?: string
}

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

export default function PublishSoulPage() {
  const router = useRouter()
  const { user, getAuthHeaders } = useAuth()
  const { signAndExecute } = usePrivySuiSign()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [price, setPrice] = useState('')
  const [readme, setReadme] = useState('')
  const [previewUpload, setPreviewUpload] = useState<WalrusUploadResult | null>(null)
  const [contentUpload, setContentUpload] = useState<WalrusUploadResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tags = useMemo(() => splitTags(tagsInput), [tagsInput])
  const priceState = getSoulPublishPriceState({ price })
  const visiblePriceErrors = getVisibleSoulPublishPriceErrors(priceState, {
    submitAttempted,
    touched: { price: price.length > 0 },
  })

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
    setPrice(draft.priceSui)
    setReadme(draft.readme)
    if (draft.previewBlobId) {
      setPreviewUpload({
        blobId: draft.previewBlobId,
        blobObjectId: null,
        contentHash: '',
      })
    }
    if (draft.contentBlobId && draft.contentBlobObjectId && draft.sealDekEnvelope) {
      setContentUpload({
        blobId: draft.contentBlobId,
        blobObjectId: draft.contentBlobObjectId,
        contentHash: '',
        sealDekEnvelope: draft.sealDekEnvelope,
      })
    }
  }, [user?.primarySuiAddress])

  useEffect(() => {
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
        priceSui: price,
        readme,
      },
    )

    writeSoulPublishDraft(window.localStorage, patchSoulPublishDraft(baseDraft, {
      previewBlobId: previewUpload?.blobId ?? null,
      contentBlobId: contentUpload?.blobId ?? null,
      contentBlobObjectId: contentUpload?.blobObjectId ?? null,
      sealDekEnvelope: contentUpload?.sealDekEnvelope ?? null,
    }))
  }, [
    user?.primarySuiAddress,
    name,
    description,
    category,
    tags,
    previewUpload,
    contentUpload,
    price,
    readme,
  ])

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitAttempted(true)
    setError(null)

    if (!user?.primarySuiAddress) {
      setError('请先绑定 Sui 钱包')
      return
    }
    if (!name.trim() || !description.trim() || !category.trim()) {
      setError('请完整填写 Soul 基本信息')
      return
    }
    if (!priceState.isComplete) {
      setError('请填写合法的 SUI 售价')
      return
    }
    if (!previewUpload) {
      setError('请先上传预览图')
      return
    }
    if (!contentUpload?.blobObjectId || !contentUpload.sealDekEnvelope) {
      setError('请先上传加密内容包')
      return
    }

    const existingDraft = typeof window !== 'undefined'
      ? readSoulPublishDraft(window.localStorage, user.primarySuiAddress)
      : null
    if (existingDraft?.soulObjectId && existingDraft.publishTxDigest && draftHasOnChainProgress(existingDraft)) {
      setSubmitting(true)
      try {
        const headers = await getAuthHeaders()
        await mirrorRouteRequest({
          input: '/api/souls/publish',
          init: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...headers,
            },
            body: JSON.stringify({
              txDigest: existingDraft.publishTxDigest,
              soulOnChainId: existingDraft.soulObjectId,
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
        router.push(`/souls/${encodeURIComponent(existingDraft.soulObjectId)}`)
        return
      } catch (retryError) {
        setError(formatMirrorSyncError(retryError, existingDraft.publishTxDigest))
      } finally {
        setSubmitting(false)
      }
      return
    }

    setSubmitting(true)
    try {
      const headers = await getAuthHeaders()
      const metadata = await uploadMetadata(headers)
      const priceSui = parseSuiPriceToMist(price)
      if (!priceSui) {
        throw new Error('Invalid SUI price')
      }

      const tx = buildMintAndListSoulTx({
        ownerAddress: user.primarySuiAddress,
        name: name.trim(),
        description: description.trim(),
        imageUrl: getBlobUrl(previewUpload.blobId),
        metadataRef: metadata.blobId,
        contentBlobObjectId: contentUpload.blobObjectId,
        category: category.trim(),
        tags,
        previewImages: [previewUpload.blobId],
        readme: readme.trim() || null,
        priceSui,
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

  return (
    <div className="min-h-screen">
      <main className="max-w-3xl mx-auto px-6 py-10">
        <form onSubmit={handleSubmit} className="glass-panel p-6 flex flex-col gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
              Publish
            </p>
            <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
              Mint a Soul
            </h1>
          </div>

          <label className="flex flex-col gap-2">
            <span style={{ color: 'var(--text-primary)' }}>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className="glass-panel px-3 py-3 bg-transparent outline-none" />
          </label>

          <label className="flex flex-col gap-2">
            <span style={{ color: 'var(--text-primary)' }}>Description</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} className="glass-panel px-3 py-3 bg-transparent outline-none" />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span style={{ color: 'var(--text-primary)' }}>Category</span>
              <input value={category} onChange={(event) => setCategory(event.target.value)} className="glass-panel px-3 py-3 bg-transparent outline-none" />
            </label>

            <label className="flex flex-col gap-2">
              <span style={{ color: 'var(--text-primary)' }}>Price (SUI)</span>
              <input value={price} onChange={(event) => setPrice(event.target.value)} className="glass-panel px-3 py-3 bg-transparent outline-none" />
              {visiblePriceErrors.price ? (
                <span className="text-sm" style={{ color: 'var(--accent-rose)' }}>{visiblePriceErrors.price}</span>
              ) : null}
            </label>
          </div>

          <label className="flex flex-col gap-2">
            <span style={{ color: 'var(--text-primary)' }}>Tags</span>
            <input value={tagsInput} onChange={(event) => setTagsInput(event.target.value)} placeholder="alpha, research, macro" className="glass-panel px-3 py-3 bg-transparent outline-none" />
          </label>

          <label className="flex flex-col gap-2">
            <span style={{ color: 'var(--text-primary)' }}>README</span>
            <textarea value={readme} onChange={(event) => setReadme(event.target.value)} rows={8} className="glass-panel px-3 py-3 bg-transparent outline-none" />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <UploadWalrus
              type="public"
              label={previewUpload ? 'Preview uploaded' : 'Upload preview image'}
              accept="image/jpeg,image/png,image/webp,image/gif"
              onUpload={setPreviewUpload}
            />
            <UploadWalrus
              type="encrypted"
              label={contentUpload ? 'Encrypted content uploaded' : 'Upload encrypted content bundle'}
              onUpload={setContentUpload}
            />
          </div>

          {error ? (
            <p className="text-sm" style={{ color: 'var(--accent-rose)' }}>{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-3 rounded-xl font-semibold"
            style={{ background: 'var(--accent-cyan)', color: '#02131a', opacity: submitting ? 0.7 : 1 }}
          >
            {submitting ? 'Publishing…' : 'Publish Soul'}
          </button>
        </form>
      </main>
    </div>
  )
}
