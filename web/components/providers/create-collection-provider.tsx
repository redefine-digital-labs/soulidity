'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useCollectionDraft } from '@/lib/collections/use-collection-draft'
import type { CollectionDraftSnapshot } from '@/lib/collections/collection-draft-store'
import { useAuth } from '@/components/providers/auth-provider'
import type { CollectionSyncResponse } from '@/lib/hooks/use-collection-publish'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@soulidity/sdk'

const PUBLISH_RESULT_KEY = 'collection-publish-result'

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
  collectionRightListed?: boolean
  collectionRightListingPrice?: string | null
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

  // Step 1.5 — optional collection-right listing on launch (when tradeable)
  /** When true, list the collection-right at launch (in PTB1). */
  listCollectionRightOnLaunch: boolean
  setListCollectionRightOnLaunch: (v: boolean) => void
  /** Display string in USDC (e.g. "12.5"). Converted to atomic at submit time. */
  collectionRightListingPrice: string
  setCollectionRightListingPrice: (v: string) => void

  // Publish result (set after on-chain TX + mirror sync)
  publishResult: CollectionSyncResponse | null
  setPublishResult: (v: CollectionSyncResponse | null, snapshot?: CollectionSuccessSnapshot | null) => void
  successSnapshot: CollectionSuccessSnapshot | null
  isHydrated: boolean
  draftReady: boolean

  // Reset
  reset: () => Promise<void>
}

const CreateCollectionContext = createContext<CreateCollectionContextValue | null>(null)

export function CreateCollectionProvider({ children }: { children: React.ReactNode }) {
  const { walletAddress } = useAuth()
  const scope = `collection-edit:${walletAddress?.toLowerCase() ?? 'local-anonymous'}`
  return <ScopedCollectionProvider key={scope} scope={scope}>{children}</ScopedCollectionProvider>
}

function ScopedCollectionProvider({ children, scope }: { children: React.ReactNode; scope: string }) {
  const { user } = useAuth()
  const providerAlive = useRef(false)
  useEffect(() => { providerAlive.current = true; return () => { providerAlive.current = false } }, [])

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

  const [listCollectionRightOnLaunch, setListCollectionRightOnLaunch] = useState(false)
  const [collectionRightListingPrice, setCollectionRightListingPrice] = useState('')

  // Publish result
  const [publishResult, setPublishResultRaw] = useState<CollectionSyncResponse | null>(null)
  const [successSnapshot, setSuccessSnapshot] = useState<CollectionSuccessSnapshot | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)

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

  const snapshot = useMemo<CollectionDraftSnapshot>(() => ({
    fields: { name, description, supplyCap, unlimitedSupply, floorPrice, extraRoyaltyBps, tradeable,
      addSoulsMethod, listCollectionRightOnLaunch, collectionRightListingPrice },
    rows: batchSouls, errors: { batch: batchErrors, folders: folderErrors },
    files: [
      ...(coverImageFile ? [{ role: 'cover' as const, row: 0, file: coverImageFile }] : []),
      ...(batchFile ? [{ role: 'template' as const, row: 0, file: batchFile }] : []),
      ...[...soulFolders].flatMap(([row, files]) => [
        { role: 'character' as const, row, file: files.characterFile },
        { role: 'memory' as const, row, file: files.memoryFile },
        ...(files.imageFile ? [{ role: 'image' as const, row, file: files.imageFile }] : []),
        ...(files.skillsFile ? [{ role: 'skills' as const, row, file: files.skillsFile }] : []),
      ]),
    ],
  }), [name, description, supplyCap, unlimitedSupply, floorPrice, extraRoyaltyBps, tradeable,
    addSoulsMethod, listCollectionRightOnLaunch, collectionRightListingPrice, batchSouls,
    batchErrors, folderErrors, coverImageFile, batchFile, soulFolders])
  const draft = useCollectionDraft(scope, snapshot, saved => {
    const f = saved.fields
    for (const key of ['name', 'description', 'supplyCap', 'floorPrice', 'collectionRightListingPrice'])
      if (typeof f[key] !== 'string') throw Error('Invalid saved Collection field')
    for (const key of ['unlimitedSupply', 'tradeable', 'listCollectionRightOnLaunch'])
      if (typeof f[key] !== 'boolean') throw Error('Invalid saved Collection option')
    if (!Number.isSafeInteger(f.extraRoyaltyBps) || ![null, 'batch-upload', 'skip'].includes(f.addSoulsMethod as any)) throw Error('Invalid saved Collection configuration')
    const folders = new Map<number, Partial<SoulFolderFiles>>()
    for (const item of saved.files) {
      if (item.role === 'cover' || item.role === 'template') continue
      const entry = folders.get(item.row) ?? {}
      const key = { character: 'characterFile', memory: 'memoryFile', image: 'imageFile', skills: 'skillsFile' }[item.role]
      Object.assign(entry, { [key]: item.file }); folders.set(item.row, entry)
    }
    for (const entry of folders.values()) if (!entry.characterFile || !entry.memoryFile) throw Error('Saved Collection folder is incomplete')
    setName(f.name as string); setDescription(f.description as string); setSupplyCap(f.supplyCap as string)
    setUnlimitedSupply(f.unlimitedSupply as boolean); setFloorPrice(f.floorPrice as string)
    setExtraRoyaltyBps(f.extraRoyaltyBps as number); setTradeable(f.tradeable as boolean)
    setAddSoulsMethod(f.addSoulsMethod as 'batch-upload' | 'skip' | null)
    setListCollectionRightOnLaunch(f.listCollectionRightOnLaunch as boolean)
    setCollectionRightListingPrice(f.collectionRightListingPrice as string)
    setCoverImage(saved.files.find(file => file.role === 'cover')?.file ?? null)
    setBatchData(saved.files.find(file => file.role === 'template')?.file ?? null, saved.rows, saved.errors.batch)
    setSoulFolders(folders as SoulFolderMap); setFolderErrors(saved.errors.folders)
  })

  const reset = async () => {
    if (!providerAlive.current) throw Error('Collection wallet scope changed')
    // Completion was archived by the caller. Persist an empty editor before
    // dropping in-memory files, so a storage failure leaves this result intact.
    await draft.save({ fields: { name: '', description: '', supplyCap: '10000', unlimitedSupply: false,
      floorPrice: '', extraRoyaltyBps: 500, tradeable: true, addSoulsMethod: null,
      listCollectionRightOnLaunch: false, collectionRightListingPrice: '' }, rows: [],
      errors: { batch: [], folders: [] }, files: [] })
    if (!providerAlive.current) throw Error('Collection wallet scope changed')
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
    setListCollectionRightOnLaunch(false)
    setCollectionRightListingPrice('')
    setPublishResultRaw(null)
    setSuccessSnapshot(null)
    try {
      sessionStorage.removeItem(PUBLISH_RESULT_KEY)
    } catch {}
  }

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
      listCollectionRightOnLaunch, setListCollectionRightOnLaunch,
      collectionRightListingPrice, setCollectionRightListingPrice,
      publishResult, setPublishResult,
      successSnapshot,
      isHydrated: isHydrated && draft.settled,
      draftReady: draft.ready,
      reset,
    }}>
      <div role="status" className="mx-auto max-w-[560px] px-6 py-2 text-xs text-muted">
        {draft.status}
        {draft.status.includes('NOT saved') || draft.status.includes('could not be opened')
          ? <button type="button" onClick={draft.retry} className="ml-2 underline">Retry local draft</button> : null}
      </div>
      {draft.settled ? children : null}
    </CreateCollectionContext>
  )
}

export function useCreateCollection() {
  const ctx = useContext(CreateCollectionContext)
  if (!ctx) throw new Error('useCreateCollection must be used within CreateCollectionProvider')
  return ctx
}
