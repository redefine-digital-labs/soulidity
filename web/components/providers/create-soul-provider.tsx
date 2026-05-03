'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/components/providers/auth-provider'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@/lib/soulidity/client-session'
import type { PendingSealMaterial } from '@/lib/upload/client-seal'

const PUBLISH_RESULT_KEY = 'soul-publish-result'
const MINT_RECOVERY_KEY = 'soul-mint-recovery'
const COLLECTION_BIND_TARGET_KEY = 'soul-create-collection-bind-target'

// ── Upload result shapes ──

interface PublicUploadResult {
  blobId: string
  blobObjectId: string
  contentHash: string
  blobUrl: string
}

interface EncryptedUploadResult {
  blobId: string
  blobObjectId: string
  contentHash: string
  blobUrl: string
  sealMaterial: PendingSealMaterial
  skillName?: string | null
}

export interface UploadResults {
  ownerAddress?: string
  coverImage?: PublicUploadResult
  charFile?: EncryptedUploadResult
  memorySeed?: EncryptedUploadResult
  skillsFile?: EncryptedUploadResult
}

export function selectReusableUploadResults(
  existing: UploadResults | null,
  ownerAddress: string,
): UploadResults {
  if (!existing) {
    return { ownerAddress }
  }

  const canReuseTxBoundUploads = existing.ownerAddress === ownerAddress

  return {
    ownerAddress,
    coverImage: existing.coverImage,
    charFile: canReuseTxBoundUploads ? existing.charFile : undefined,
    memorySeed: canReuseTxBoundUploads ? existing.memorySeed : undefined,
    skillsFile: canReuseTxBoundUploads ? existing.skillsFile : undefined,
  }
}

export interface PublishResult {
  txDigest: string
  soulOnChainId: string
  stateOnChainId: string
  memoryOnChainId: string
  listingStatus: string
  listingTxDigest?: string | null
  listingObjectOnChainId?: string | null
  listedPriceAtomic?: string | null
  collectionOnChainId?: string | null
  collectionAddTxDigest?: string | null
}

interface StoredPublishResult {
  userId?: string
  result?: PublishResult
  deploymentSignature?: string
}

export interface CollectionBindTarget {
  collectionOnChainId: string
}

interface StoredCollectionBindTarget {
  userId?: string
  target?: CollectionBindTarget | null
  deploymentSignature?: string
}

function normalizeCollectionBindTarget(target: CollectionBindTarget | null | undefined): CollectionBindTarget | null {
  const collectionOnChainId = target?.collectionOnChainId?.trim()
  return collectionOnChainId ? { collectionOnChainId } : null
}

function readStoredPublishResult(userId: string | null): PublishResult | null {
  if (!userId || typeof window === 'undefined') {
    return null
  }

  try {
    const raw = sessionStorage.getItem(PUBLISH_RESULT_KEY)
    if (!raw) {
      return null
    }

    const stored = JSON.parse(raw) as StoredPublishResult
    return stored.userId === userId && stored.result && hasCurrentSoulidityDeploymentSignature(stored)
      ? stored.result
      : null
  } catch {
    return null
  }
}

function readStoredCollectionBindTarget(userId: string | null): CollectionBindTarget | null {
  if (!userId || typeof window === 'undefined') {
    return null
  }

  try {
    const raw = sessionStorage.getItem(COLLECTION_BIND_TARGET_KEY)
    if (!raw) {
      return null
    }

    const stored = JSON.parse(raw) as StoredCollectionBindTarget
    return stored.userId === userId && stored.target && hasCurrentSoulidityDeploymentSignature(stored)
      ? normalizeCollectionBindTarget(stored.target)
      : null
  } catch {
    return null
  }
}

// ── Context value ──

interface CreateSoulContextValue {
  // Step 1
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  tags: string
  setTags: (v: string) => void
  royalty: number
  setRoyalty: (v: number) => void
  coverImageFile: File | null
  coverImagePreviewUrl: string | null
  setCoverImage: (file: File | null) => void

  // Step 2
  memoryFile: File | null
  setMemoryFile: (file: File | null) => void
  charFile: File | null
  setCharFile: (file: File | null) => void
  skillsFile: File | null
  setSkillsFile: (file: File | null) => void

  // Upload results (populated during step 4)
  uploadResults: UploadResults | null
  setUploadResults: (results: UploadResults) => void

  // Publish results (populated after successful TX)
  publishResult: PublishResult | null
  setPublishResult: (result: PublishResult | null) => void
  collectionBindTarget: CollectionBindTarget | null
  setCollectionBindTarget: (target: CollectionBindTarget | null) => void

  /** When true, list the soul on publish at `listingPriceAtomic`. */
  listOnPublish: boolean
  setListOnPublish: (value: boolean) => void
  /** USDC atomic price string. Required when listOnPublish is true. */
  listingPriceAtomic: string | null
  setListingPriceAtomic: (value: string | null) => void

  // True after sessionStorage hydration is complete (safe to evaluate publishResult guards)
  isHydrated: boolean

  // Reset
  reset: () => void
}

const CreateSoulContext = createContext<CreateSoulContextValue | null>(null)

export function CreateSoulProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const userId = user?.id ?? null
  return (
    <CreateSoulProviderInner
      authLoading={loading}
      userId={userId}
    >
      {children}
    </CreateSoulProviderInner>
  )
}

function CreateSoulProviderInner({
  children,
  authLoading,
  userId,
}: {
  children: React.ReactNode
  authLoading: boolean
  userId: string | null
}) {

  // Step 1
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [royalty, setRoyalty] = useState(500)
  const [coverImageFile, setCoverImageFileRaw] = useState<File | null>(null)
  const [coverImagePreviewUrl, setCoverImagePreviewUrl] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  // Step 2
  const [memoryFile, setMemoryFileRaw] = useState<File | null>(null)
  const [charFile, setCharFileRaw] = useState<File | null>(null)
  const [skillsFile, setSkillsFileRaw] = useState<File | null>(null)

  // Step 4 results
  const [uploadResults, setUploadResultsRaw] = useState<UploadResults | null>(null)
  const setUploadResults = useCallback((results: UploadResults) => {
    setUploadResultsRaw(results)
  }, [])

  // Wrapped input setters — invalidate the corresponding cached upload slot on change
  const setCharFile = useCallback((file: File | null) => {
    setCharFileRaw(file)
    setUploadResultsRaw(prev => prev ? { ...prev, charFile: undefined } : prev)
  }, [])

  const setSkillsFile = useCallback((file: File | null) => {
    setSkillsFileRaw(file)
    setUploadResultsRaw(prev => prev ? { ...prev, skillsFile: undefined } : prev)
  }, [])

  const setMemoryFile = useCallback((file: File | null) => {
    setMemoryFileRaw(file)
    setUploadResultsRaw(prev => prev ? { ...prev, memorySeed: undefined } : prev)
  }, [])
  const [publishResult, setPublishResultRaw] = useState<PublishResult | null>(null)
  const [collectionBindTarget, setCollectionBindTargetRaw] = useState<CollectionBindTarget | null>(null)
  const [listOnPublish, setListOnPublish] = useState<boolean>(false)
  const [listingPriceAtomic, setListingPriceAtomic] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  // Tracks the userId we've already hydrated for, so we can re-hydrate on
  // userId change without calling setState inside a useEffect (which React
  // flags as cascading renders).
  const [hydratedForUserId, setHydratedForUserId] = useState<string | null | undefined>(undefined)

  // Adjust state during render when auth finishes or userId changes — the
  // idiomatic React pattern for resetting derived state on prop change.
  if (!authLoading && hydratedForUserId !== userId) {
    setHydratedForUserId(userId)
    setPublishResultRaw(readStoredPublishResult(userId))
    setCollectionBindTargetRaw(readStoredCollectionBindTarget(userId))
    setIsHydrated(true)
  }

  const setPublishResult = useCallback((result: PublishResult | null) => {
    setPublishResultRaw(result)
    try {
      if (result && userId) {
        sessionStorage.setItem(PUBLISH_RESULT_KEY, JSON.stringify(attachSoulidityDeploymentSignature({ userId, result })))
      } else {
        sessionStorage.removeItem(PUBLISH_RESULT_KEY)
      }
    } catch { /* storage quota exceeded */ }
  }, [userId])

  const setCollectionBindTarget = useCallback((target: CollectionBindTarget | null) => {
    const normalized = normalizeCollectionBindTarget(target)
    setCollectionBindTargetRaw(normalized)
    try {
      if (normalized && userId) {
        sessionStorage.setItem(
          COLLECTION_BIND_TARGET_KEY,
          JSON.stringify(attachSoulidityDeploymentSignature({ userId, target: normalized })),
        )
      } else {
        sessionStorage.removeItem(COLLECTION_BIND_TARGET_KEY)
      }
    } catch { /* storage quota exceeded */ }
  }, [userId])

  // Cover image preview URL lifecycle
  const setCoverImage = useCallback((file: File | null) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    if (file) {
      const url = URL.createObjectURL(file)
      previewUrlRef.current = url
      setCoverImagePreviewUrl(url)
    } else {
      setCoverImagePreviewUrl(null)
    }
    setCoverImageFileRaw(file)
    setUploadResultsRaw(prev => prev ? { ...prev, coverImage: undefined } : prev)
  }, [])

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
      }
    }
  }, [])

  const reset = useCallback(() => {
    setName('')
    setDescription('')
    setTags('')
    setRoyalty(500)
    setCoverImage(null)
    setMemoryFileRaw(null)
    setCharFileRaw(null)
    setSkillsFileRaw(null)
    setUploadResultsRaw(null)
    setPublishResultRaw(null)
    setCollectionBindTargetRaw(null)
    setListOnPublish(false)
    setListingPriceAtomic(null)
    try {
      sessionStorage.removeItem(PUBLISH_RESULT_KEY)
      sessionStorage.removeItem(MINT_RECOVERY_KEY)
      sessionStorage.removeItem(COLLECTION_BIND_TARGET_KEY)
    } catch {}
  }, [setCoverImage])

  return (
    <CreateSoulContext value={{
      name, setName,
      description, setDescription,
      tags, setTags,
      royalty, setRoyalty,
      coverImageFile, coverImagePreviewUrl, setCoverImage,
      memoryFile, setMemoryFile,
      charFile, setCharFile,
      skillsFile, setSkillsFile,
      uploadResults, setUploadResults,
      publishResult, setPublishResult,
      collectionBindTarget, setCollectionBindTarget,
      listOnPublish, setListOnPublish,
      listingPriceAtomic, setListingPriceAtomic,
      isHydrated,
      reset,
    }}>
      {children}
    </CreateSoulContext>
  )
}

export function useCreateSoul() {
  const ctx = useContext(CreateSoulContext)
  if (!ctx) throw new Error('useCreateSoul must be used within CreateSoulProvider')
  return ctx
}
