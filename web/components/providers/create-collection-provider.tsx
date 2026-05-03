'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/components/providers/auth-provider'
import type { CollectionSyncResponse } from '@/lib/hooks/use-collection-publish'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@/lib/soulidity/client-session'

const PUBLISH_RESULT_KEY = 'collection-publish-result'
const MINT_RECOVERY_KEY = 'collection-mint-recovery'

// ── Shared step definitions ──

export const collectionSteps = [
  { label: 'Collection Info' },
  { label: 'Add Souls' },
  { label: 'Preview' },
  { label: 'Launched' },
]

// ── Success snapshot (persisted alongside publishResult for refresh-safe success page) ──

export interface CollectionSuccessSnapshot {
  name: string
  floorPrice: string
  extraRoyaltyBps: number
  tradeable: boolean
  soulNames: string[]
  // Atomic-safe representation. null = unlimited, otherwise a positive integer
  // string mirroring the on-chain cap.
  maxSoulSupply: string | null
  /** True when the collection was launched with no Souls (`Add Souls when ready` flow). */
  emptyCollection: boolean
}

interface StoredCollectionPublishResult {
  userId?: string
  result?: CollectionSyncResponse
  snapshot?: CollectionSuccessSnapshot | null
  deploymentSignature?: string
}

// ── Batch soul entry (template metadata only — files come from folder) ──

export interface BatchSoulEntry {
  name: string
  description: string
  tags: string[]
  creatorRoyaltyBps: number
}

// ── Soul folder files ──

export interface SoulFolderFiles {
  characterFile: File    // soul.md — required
  memoryFile: File       // memory.md — required
  imageFile?: File       // first image found in subfolder
  skillsFile?: File      // skills.zip
}

/** Files from numbered subfolders, keyed by 1-indexed folder number */
export type SoulFolderMap = Map<number, SoulFolderFiles>

// ── Context value ──

interface CreateCollectionContextValue {
  // Step 1 — Collection Info
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  coverImageFile: File | null
  coverImagePreviewUrl: string | null
  setCoverImage: (file: File | null) => void
  supplyCap: string
  setSupplyCap: (v: string) => void
  unlimitedSupply: boolean
  setUnlimitedSupply: (v: boolean) => void
  floorPrice: string
  setFloorPrice: (v: string) => void
  extraRoyaltyBps: number
  setExtraRoyaltyBps: (v: number) => void
  tradeable: boolean
  setTradeable: (v: boolean) => void

  // Step 2 — Add Souls (batch upload | skip)
  // null = no method picked yet (legacy meaning preserved); 'skip' = launch
  // with zero Souls and add later from the collection detail page.
  addSoulsMethod: 'batch-upload' | 'skip' | null
  setAddSoulsMethod: (v: 'batch-upload' | 'skip' | null) => void
  batchFile: File | null
  batchSouls: BatchSoulEntry[]
  batchErrors: string[]
  setBatchData: (file: File | null, souls: BatchSoulEntry[], errors: string[]) => void
  soulFolders: SoulFolderMap
  setSoulFolders: (folders: SoulFolderMap) => void
  folderErrors: string[]
  setFolderErrors: (errors: string[]) => void

  // Publish result (set after on-chain TX + mirror sync)
  publishResult: CollectionSyncResponse | null
  setPublishResult: (v: CollectionSyncResponse | null, snapshot?: CollectionSuccessSnapshot | null) => void
  successSnapshot: CollectionSuccessSnapshot | null
  isHydrated: boolean
  /** True when a committed collection TX exists in recovery — allows bypassing File-dependent guards */
  hasRecoveryTx: boolean

  // Reset
  reset: () => void
}

const CreateCollectionContext = createContext<CreateCollectionContextValue | null>(null)

export function CreateCollectionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()

  // Step 1
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [coverImageFile, setCoverImageFileRaw] = useState<File | null>(null)
  const [coverImagePreviewUrl, setCoverImagePreviewUrl] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  // Default 10000 mirrors the marketing copy. Locked on launch.
  const [supplyCap, setSupplyCap] = useState('10000')
  const [unlimitedSupply, setUnlimitedSupply] = useState(false)
  const [floorPrice, setFloorPrice] = useState('')
  const [extraRoyaltyBps, setExtraRoyaltyBps] = useState(500)
  const [tradeable, setTradeable] = useState(true)

  // Step 2
  const [addSoulsMethod, setAddSoulsMethod] = useState<'batch-upload' | 'skip' | null>(null)
  const [batchFile, setBatchFile] = useState<File | null>(null)
  const [batchSouls, setBatchSouls] = useState<BatchSoulEntry[]>([])
  const [batchErrors, setBatchErrors] = useState<string[]>([])
  const [soulFolders, setSoulFolders] = useState<SoulFolderMap>(new Map())
  const [folderErrors, setFolderErrors] = useState<string[]>([])

  // Publish result
  const [publishResult, setPublishResultRaw] = useState<CollectionSyncResponse | null>(null)
  const [successSnapshot, setSuccessSnapshot] = useState<CollectionSuccessSnapshot | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const [hasRecoveryTx, setHasRecoveryTx] = useState(false)

  const setBatchData = useCallback((file: File | null, souls: BatchSoulEntry[], errors: string[]) => {
    setBatchFile(file)
    setBatchSouls(souls)
    setBatchErrors(errors)
  }, [])

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
  }, [])

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      try {
        const raw = sessionStorage.getItem(PUBLISH_RESULT_KEY)
        if (raw) {
          const stored = JSON.parse(raw) as StoredCollectionPublishResult
          if (stored.userId === user?.id && stored.result && hasCurrentSoulidityDeploymentSignature(stored)) {
            setPublishResultRaw(stored.result)
            if (stored.snapshot) setSuccessSnapshot(stored.snapshot)
          } else {
            sessionStorage.removeItem(PUBLISH_RESULT_KEY)
          }
        }
      } catch { /* ignore corrupt/missing storage */ }

      // Hydrate draft inputs from recovery state so the preview page
      // can resume a partially-completed collection launch after refresh
      try {
        const recoveryRaw = sessionStorage.getItem(MINT_RECOVERY_KEY)
        if (recoveryRaw) {
          const recovery = JSON.parse(recoveryRaw)
          if (recovery.userId === user?.id && recovery.txDigest && recovery.collectionMeta && hasCurrentSoulidityDeploymentSignature(recovery)) {
            const meta = recovery.collectionMeta
            setName(meta.name ?? '')
            setDescription(meta.description ?? '')
            setExtraRoyaltyBps(meta.extraRoyaltyBps ?? 500)
            setTradeable(meta.tradeable ?? true)
            if (typeof meta.maxSupply === 'number' && meta.maxSupply > 0) {
              setSupplyCap(String(meta.maxSupply))
              setUnlimitedSupply(false)
            } else if (meta.maxSupply === null) {
              setUnlimitedSupply(true)
            }
            if (recovery.floorPriceAtomic) {
              // Convert atomic back to display string (inverse of parseDisplayAmountToAtomic)
              const v = BigInt(recovery.floorPriceAtomic)
              const factor = 10n ** 6n
              const whole = v / factor
              const frac = (v % factor).toString().padStart(6, '0').replace(/0+$/, '')
              setFloorPrice(frac ? `${whole}.${frac}` : whole.toString())
            }
            if (Array.isArray(recovery.souls) && recovery.souls.length > 0) {
              setBatchSouls(recovery.souls.map((s: { input?: BatchSoulEntry }) => ({
                name: s.input?.name ?? '',
                description: s.input?.description ?? '',
                tags: Array.isArray(s.input?.tags) ? s.input.tags : [],
                creatorRoyaltyBps: s.input?.creatorRoyaltyBps ?? 0,
              })))
            }
            setHasRecoveryTx(true)
          }
        }
      } catch { /* ignore corrupt/missing recovery */ }

      setIsHydrated(true)
    })
    return () => { cancelled = true }
  }, [user?.id])

  const setPublishResult = (result: CollectionSyncResponse | null, snapshot?: CollectionSuccessSnapshot | null) => {
    setPublishResultRaw(result)
    setSuccessSnapshot(snapshot ?? null)
    try {
      if (result && user?.id) {
        sessionStorage.setItem(
          PUBLISH_RESULT_KEY,
          JSON.stringify(attachSoulidityDeploymentSignature({ userId: user.id, result, snapshot: snapshot ?? null })),
        )
      } else {
        sessionStorage.removeItem(PUBLISH_RESULT_KEY)
      }
    } catch { /* storage quota exceeded */ }
  }

  const reset = useCallback(() => {
    setName('')
    setDescription('')
    setCoverImage(null)
    setSupplyCap('10000')
    setUnlimitedSupply(false)
    setFloorPrice('')
    setExtraRoyaltyBps(500)
    setTradeable(true)
    setAddSoulsMethod(null)
    setBatchData(null, [], [])
    setSoulFolders(new Map())
    setFolderErrors([])
    setPublishResultRaw(null)
    setSuccessSnapshot(null)
    setHasRecoveryTx(false)
    try {
      sessionStorage.removeItem(PUBLISH_RESULT_KEY)
      sessionStorage.removeItem(MINT_RECOVERY_KEY)
    } catch {}
  }, [setCoverImage, setBatchData])

  return (
    <CreateCollectionContext value={{
      name, setName,
      description, setDescription,
      coverImageFile, coverImagePreviewUrl, setCoverImage,
      supplyCap, setSupplyCap,
      unlimitedSupply, setUnlimitedSupply,
      floorPrice, setFloorPrice,
      extraRoyaltyBps, setExtraRoyaltyBps,
      tradeable, setTradeable,
      addSoulsMethod, setAddSoulsMethod,
      batchFile, batchSouls, batchErrors, setBatchData,
      soulFolders, setSoulFolders,
      folderErrors, setFolderErrors,
      publishResult, setPublishResult,
      successSnapshot,
      isHydrated,
      hasRecoveryTx,
      reset,
    }}>
      {children}
    </CreateCollectionContext>
  )
}

export function useCreateCollection() {
  const ctx = useContext(CreateCollectionContext)
  if (!ctx) throw new Error('useCreateCollection must be used within CreateCollectionProvider')
  return ctx
}
