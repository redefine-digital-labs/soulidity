'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedField, ParseStats } from '@/lib/import/file-parser'
import type { FieldMapping, SoulTargetField } from '@/lib/import/field-mapping'
import { useAuth } from '@/components/providers/auth-provider'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@/lib/soulidity/client-session'

const IMPORT_RESULT_KEY = 'soul-import-result'
const IMPORT_RECOVERY_KEY = 'soul-import-recovery'

// ── Upload result shapes (same as create-soul-provider) ──

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
  sealDekEnvelope: string
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
  if (!existing) return { ownerAddress }
  const canReuse = existing.ownerAddress === ownerAddress
  return {
    ownerAddress,
    coverImage: existing.coverImage,
    charFile: canReuse ? existing.charFile : undefined,
    memorySeed: canReuse ? existing.memorySeed : undefined,
    skillsFile: canReuse ? existing.skillsFile : undefined,
  }
}

// ── Import result ──

export interface ImportResult {
  txDigest: string
  soulOnChainId: string
  provenanceKind: string
  originRef: string
}

interface StoredImportResult {
  userId?: string
  result?: ImportResult
  deploymentSignature?: string
}

function readStoredImportResult(userId: string | null): ImportResult | null {
  if (!userId || typeof window === 'undefined') {
    return null
  }

  try {
    const raw = sessionStorage.getItem(IMPORT_RESULT_KEY)
    if (!raw) {
      return null
    }

    const stored = JSON.parse(raw) as StoredImportResult
    return stored.userId === userId && stored.result && hasCurrentSoulidityDeploymentSignature(stored)
      ? stored.result
      : null
  } catch {
    return null
  }
}

// ── Context ──

interface ImportSoulContextValue {
  // Step 1
  sourceType: 'local-file' | null
  setSourceType: (v: 'local-file' | null) => void

  // Step 2
  rawFile: File | null
  setRawFile: (f: File | null) => void
  parsedFields: ParsedField[]
  setParsedFields: (fields: ParsedField[]) => void
  parseStats: ParseStats | null
  setParseStats: (stats: ParseStats | null) => void
  parseError: string | null
  setParseError: (err: string | null) => void
  originRef: string
  setOriginRef: (v: string) => void

  // Step 3
  fieldMappings: FieldMapping[]
  setFieldMappings: (mappings: FieldMapping[]) => void
  updateMapping: (sourceKey: string, targetField: SoulTargetField) => void
  manualName: string
  setManualName: (v: string) => void
  manualDescription: string
  setManualDescription: (v: string) => void
  charFile: File | null
  setCharFile: (f: File | null) => void
  memoryFile: File | null
  setMemoryFile: (f: File | null) => void
  skillsFile: File | null
  setSkillsFile: (f: File | null) => void
  coverImageFile: File | null
  coverImagePreviewUrl: string | null
  setCoverImage: (f: File | null) => void
  royalty: number
  setRoyalty: (v: number) => void
  tags: string
  setTags: (v: string) => void

  // Derived: mapping value if mapped, otherwise manual input
  resolvedName: string
  resolvedDescription: string
  /** True when name comes from mapping (not manual input) */
  nameMapped: boolean
  /** True when description comes from mapping (not manual input) */
  descriptionMapped: boolean

  // Step 5
  uploadResults: UploadResults | null
  setUploadResults: (r: UploadResults) => void

  // Step 6
  importResult: ImportResult | null
  setImportResult: (r: ImportResult | null) => void
  isHydrated: boolean

  reset: () => void
}

const ImportSoulContext = createContext<ImportSoulContextValue | null>(null)

export function ImportSoulProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const userId = user?.id ?? null
  return (
    <ImportSoulProviderInner
      authLoading={loading}
      userId={userId}
    >
      {children}
    </ImportSoulProviderInner>
  )
}

function ImportSoulProviderInner({
  children,
  authLoading,
  userId,
}: {
  children: React.ReactNode
  authLoading: boolean
  userId: string | null
}) {

  // Step 1
  const [sourceType, setSourceType] = useState<'local-file' | null>(null)

  // Step 2
  const [rawFile, setRawFileRaw] = useState<File | null>(null)
  const [parsedFields, setParsedFields] = useState<ParsedField[]>([])
  const [parseStats, setParseStats] = useState<ParseStats | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [originRef, setOriginRef] = useState('')

  // Step 3
  const [fieldMappings, setFieldMappingsRaw] = useState<FieldMapping[]>([])
  const [manualName, setManualName] = useState('')
  const [manualDescription, setManualDescription] = useState('')
  const [charFile, setCharFileRaw] = useState<File | null>(null)
  const [memoryFile, setMemoryFileRaw] = useState<File | null>(null)
  const [skillsFile, setSkillsFileRaw] = useState<File | null>(null)
  const [coverImageFile, setCoverImageFileRaw] = useState<File | null>(null)
  const [coverImagePreviewUrl, setCoverImagePreviewUrl] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [royalty, setRoyalty] = useState(500)
  const [tags, setTags] = useState('')

  // Step 5
  const [uploadResults, setUploadResultsRaw] = useState<UploadResults | null>(null)
  const setUploadResults = useCallback((r: UploadResults) => setUploadResultsRaw(r), [])

  // Step 6
  const [importResult, setImportResultRaw] = useState<ImportResult | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  // Tracks the userId we've already hydrated for, so we can re-hydrate on
  // userId change without setState inside useEffect (React flags as cascading).
  const [hydratedForUserId, setHydratedForUserId] = useState<string | null | undefined>(undefined)

  if (!authLoading && hydratedForUserId !== userId) {
    setHydratedForUserId(userId)
    setImportResultRaw(readStoredImportResult(userId))
    setIsHydrated(true)
  }

  const setImportResult = useCallback((result: ImportResult | null) => {
    setImportResultRaw(result)
    try {
      if (result && userId) {
        sessionStorage.setItem(IMPORT_RESULT_KEY, JSON.stringify(attachSoulidityDeploymentSignature({ userId, result })))
      } else {
        sessionStorage.removeItem(IMPORT_RESULT_KEY)
      }
    } catch { /* storage quota */ }
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
    setUploadResultsRaw((prev) => (prev ? { ...prev, coverImage: undefined } : prev))
  }, [])


  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  // Invalidate upload caches on file change
  const setCharFile = useCallback((f: File | null) => {
    setCharFileRaw(f)
    setUploadResultsRaw((prev) => (prev ? { ...prev, charFile: undefined } : prev))
  }, [])

  const setMemoryFile = useCallback((f: File | null) => {
    setMemoryFileRaw(f)
    setUploadResultsRaw((prev) => (prev ? { ...prev, memorySeed: undefined } : prev))
  }, [])

  const setSkillsFile = useCallback((f: File | null) => {
    setSkillsFileRaw(f)
    setUploadResultsRaw((prev) => (prev ? { ...prev, skillsFile: undefined } : prev))
  }, [])

  const setRawFile = useCallback((f: File | null) => {
    setRawFileRaw(f)
    // Clear all downstream state derived from the previous source file
    setParsedFields([])
    setParseStats(null)
    setParseError(null)
    setOriginRef('')
    setFieldMappingsRaw([])
    setManualName('')
    setManualDescription('')
    setCharFileRaw(null)
    setMemoryFileRaw(null)
    setSkillsFileRaw(null)
    setCoverImage(null)
    setUploadResultsRaw(null)
    setImportResultRaw(null)
    try {
      sessionStorage.removeItem(IMPORT_RESULT_KEY)
      // IMPORT_RECOVERY_KEY is intentionally NOT cleared here — a committed TX
      // recovery must survive draft edits from back-navigation. Only reset()
      // (explicit "Start Over") clears the recovery key.
    } catch {}
  }, [setCoverImage])

  const setFieldMappings = useCallback((mappings: FieldMapping[]) => {
    setFieldMappingsRaw(mappings)
  }, [])

  const updateMapping = useCallback((sourceKey: string, targetField: SoulTargetField) => {
    setFieldMappingsRaw((prev) =>
      prev.map((m) => {
        if (m.sourceKey === sourceKey) return { ...m, targetField, confidence: 1 }
        // Auto-clear duplicate: if another row already targets the same field, reset it to skip
        if (targetField !== 'skip' && m.targetField === targetField) return { ...m, targetField: 'skip', confidence: 0 }
        return m
      }),
    )
  }, [])

  // Derived: resolve name/description from mappings, fallback to manual input
  const mappedName = useMemo(() => {
    const mapping = fieldMappings.find((m) => m.targetField === 'name')
    if (!mapping) return ''
    const field = parsedFields.find((f) => f.key === mapping.sourceKey)
    return typeof field?.value === 'string' ? field.value : field?.displayValue ?? ''
  }, [fieldMappings, parsedFields])

  const mappedDescription = useMemo(() => {
    const mapping = fieldMappings.find((m) => m.targetField === 'description')
    if (!mapping) return ''
    const field = parsedFields.find((f) => f.key === mapping.sourceKey)
    return typeof field?.value === 'string' ? field.value : field?.displayValue ?? ''
  }, [fieldMappings, parsedFields])

  const nameMapped = !!mappedName
  const descriptionMapped = !!mappedDescription
  const resolvedName = mappedName || manualName
  const resolvedDescription = mappedDescription || manualDescription

  const reset = useCallback(() => {
    setSourceType(null)
    setRawFileRaw(null)
    setParsedFields([])
    setParseStats(null)
    setParseError(null)
    setOriginRef('')
    setFieldMappingsRaw([])
    setManualName('')
    setManualDescription('')
    setCharFileRaw(null)
    setMemoryFileRaw(null)
    setSkillsFileRaw(null)
    setCoverImage(null)
    setRoyalty(500)
    setTags('')
    setUploadResultsRaw(null)
    setImportResultRaw(null)
    try {
      sessionStorage.removeItem(IMPORT_RESULT_KEY)
      sessionStorage.removeItem(IMPORT_RECOVERY_KEY)
    } catch {}
  }, [setCoverImage])

  return (
    <ImportSoulContext value={{
      sourceType, setSourceType,
      rawFile, setRawFile,
      parsedFields, setParsedFields,
      parseStats, setParseStats,
      parseError, setParseError,
      originRef, setOriginRef,
      fieldMappings, setFieldMappings, updateMapping,
      manualName, setManualName,
      manualDescription, setManualDescription,
      charFile, setCharFile,
      memoryFile, setMemoryFile,
      skillsFile, setSkillsFile,
      coverImageFile, coverImagePreviewUrl, setCoverImage,
      royalty, setRoyalty,
      tags, setTags,
      resolvedName, resolvedDescription, nameMapped, descriptionMapped,
      uploadResults, setUploadResults,
      importResult, setImportResult,
      isHydrated,
      reset,
    }}>
      {children}
    </ImportSoulContext>
  )
}

export function useImportSoul() {
  const ctx = useContext(ImportSoulContext)
  if (!ctx) throw new Error('useImportSoul must be used within ImportSoulProvider')
  return ctx
}
