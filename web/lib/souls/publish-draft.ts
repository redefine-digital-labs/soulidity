import { normalizeSuiAddress } from '@mysten/sui/utils'

// Keep the storage key stable for wallet-scoped draft lookup across reloads.
// Incompatible saved drafts are intentionally discarded by the serialized `version` gate.
export const SOUL_PUBLISH_DRAFT_STORAGE_KEY = 'soul-publish-draft-v2'

const SOUL_PUBLISH_DRAFT_VERSION = 4 as const

export type SoulPublishDraft = {
  version: typeof SOUL_PUBLISH_DRAFT_VERSION
  walletAddress: string
  name: string
  description: string
  category: string
  tags: string[]
  imageUrl: string
  priceInput: string
  listForSale: boolean
  creatorRoyaltyBps: string
  readme: string
  previewBlobId: string | null
  previewFileKey: string | null
  contentBlobId: string | null
  contentBlobObjectId: string | null
  metadataRef: string | null
  sealDekEnvelope: string | null
  soulObjectId: string | null
  currentKioskId: string | null
  publishTxDigest: string | null
  dbMirroredAt: string | null
  updatedAt: string
}

export type SoulPublishDraftPatch = Partial<
  Omit<SoulPublishDraft, 'version' | 'walletAddress' | 'updatedAt'>
>

export type SoulPublishRetrySnapshot = {
  txDigest: string
  soulObjectId: string
  contentBlobId: string
  contentBlobObjectId: string
  sealDekEnvelope: string
  category: string
  tags: string[]
  previewImages: string[]
  readme: string | null
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

type SoulPublishDraftInput = {
  walletAddress: string
  name: string
  description: string
  category: string
  tags: string[]
  imageUrl: string
  priceInput: string
  listForSale: boolean
  creatorRoyaltyBps: string
  readme: string
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeDraftWalletAddress(walletAddress: string): string {
  const trimmed = walletAddress.trim()
  if (!trimmed) {
    return ''
  }

  try {
    return normalizeSuiAddress(trimmed)
  } catch {
    return trimmed.toLowerCase()
  }
}

function getWalletScopedDraftStorageKey(walletAddress: string): string {
  return `${SOUL_PUBLISH_DRAFT_STORAGE_KEY}:${normalizeDraftWalletAddress(walletAddress)}`
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function clearPreparedContentArtifacts(draft: SoulPublishDraft): SoulPublishDraft {
  return {
    ...draft,
    contentBlobId: null,
    contentBlobObjectId: null,
    metadataRef: null,
    sealDekEnvelope: null,
  }
}

function sanitizeRecoveredProgress(draft: SoulPublishDraft): SoulPublishDraft {
  const hasSoulObjectId = draft.soulObjectId != null
  const hasCurrentKioskId = draft.currentKioskId != null
  const hasPublishTxDigest = draft.publishTxDigest != null
  if (!hasSoulObjectId && !hasCurrentKioskId && !hasPublishTxDigest) {
    return clearPreparedContentArtifacts(draft)
  }
  if (hasSoulObjectId || (!hasCurrentKioskId && !hasPublishTxDigest)) {
    return draft
  }

  return {
    ...clearPreparedContentArtifacts(draft),
    currentKioskId: null,
    publishTxDigest: null,
  }
}

export function createSoulPublishDraft(input: SoulPublishDraftInput): SoulPublishDraft {
  return {
    version: SOUL_PUBLISH_DRAFT_VERSION,
    walletAddress: input.walletAddress,
    name: input.name,
    description: input.description,
    category: input.category,
    tags: input.tags,
    imageUrl: input.imageUrl,
    priceInput: input.priceInput,
    listForSale: input.listForSale,
    creatorRoyaltyBps: input.creatorRoyaltyBps,
    readme: input.readme,
    previewBlobId: null,
    previewFileKey: null,
    contentBlobId: null,
    contentBlobObjectId: null,
    metadataRef: null,
    sealDekEnvelope: null,
    soulObjectId: null,
    currentKioskId: null,
    publishTxDigest: null,
    dbMirroredAt: null,
    updatedAt: nowIso(),
  }
}

export function syncSoulPublishDraftForSubmit(
  draft: SoulPublishDraft | null,
  input: SoulPublishDraftInput,
): SoulPublishDraft {
  if (!draft) {
    return createSoulPublishDraft(input)
  }
  if (draftHasOnChainProgress(draft)) {
    return draft
  }
  return patchSoulPublishDraft(draft, {
    name: input.name,
    description: input.description,
    category: input.category,
    tags: input.tags,
    imageUrl: input.imageUrl,
    priceInput: input.priceInput,
    listForSale: input.listForSale,
    creatorRoyaltyBps: input.creatorRoyaltyBps,
    readme: input.readme,
  })
}

export function patchSoulPublishDraft(
  draft: SoulPublishDraft,
  patch: SoulPublishDraftPatch,
): SoulPublishDraft {
  return {
    ...draft,
    ...patch,
    updatedAt: nowIso(),
  }
}

export function parseSoulPublishDraft(raw: string | null): SoulPublishDraft | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      parsed.version !== SOUL_PUBLISH_DRAFT_VERSION
      || typeof parsed.walletAddress !== 'string'
      || typeof parsed.name !== 'string'
      || typeof parsed.description !== 'string'
      || typeof parsed.category !== 'string'
      || !isStringArray(parsed.tags)
      || typeof parsed.imageUrl !== 'string'
      || typeof parsed.priceInput !== 'string'
      || typeof parsed.listForSale !== 'boolean'
      || typeof parsed.creatorRoyaltyBps !== 'string'
      || typeof parsed.readme !== 'string'
      || !isNullableString(parsed.previewBlobId)
      || !isNullableString(parsed.previewFileKey)
      || !isNullableString(parsed.contentBlobId)
      || !isNullableString(parsed.contentBlobObjectId)
      || !isNullableString(parsed.metadataRef)
      || !isNullableString(parsed.sealDekEnvelope)
      || !isNullableString(parsed.soulObjectId)
      || !isNullableString(parsed.currentKioskId)
      || !isNullableString(parsed.publishTxDigest)
      || !isNullableString(parsed.dbMirroredAt)
      || typeof parsed.updatedAt !== 'string'
    ) {
      return null
    }

    return sanitizeRecoveredProgress(parsed as SoulPublishDraft)
  } catch {
    return null
  }
}

export function readSoulPublishDraft(storage: StorageLike, walletAddress: string): SoulPublishDraft | null {
  const walletKey = getWalletScopedDraftStorageKey(walletAddress)
  const draft = parseSoulPublishDraft(storage.getItem(walletKey))
  if (!draft) {
    return null
  }
  if (normalizeDraftWalletAddress(draft.walletAddress) !== normalizeDraftWalletAddress(walletAddress)) {
    return null
  }
  return draft.dbMirroredAt ? null : draft
}

export function writeSoulPublishDraft(storage: StorageLike, draft: SoulPublishDraft) {
  storage.setItem(getWalletScopedDraftStorageKey(draft.walletAddress), JSON.stringify(draft))
}

export function clearSoulPublishDraft(storage: StorageLike, walletAddress?: string) {
  if (walletAddress) {
    storage.removeItem(getWalletScopedDraftStorageKey(walletAddress))
  }
}

export function draftHasOnChainProgress(draft: SoulPublishDraft | null) {
  return Boolean(draft?.soulObjectId || draft?.currentKioskId || draft?.publishTxDigest)
}

export function readSoulPublishRetrySnapshot(
  draft: SoulPublishDraft | null,
): SoulPublishRetrySnapshot | null {
  if (
    !draft
    || !draftHasOnChainProgress(draft)
    || !draft.soulObjectId
    || !draft.publishTxDigest
    || !draft.contentBlobId
    || !draft.contentBlobObjectId
    || !draft.sealDekEnvelope
    || !draft.category.trim()
    || draft.tags.length === 0
    || !draft.previewBlobId
  ) {
    return null
  }

  return {
    txDigest: draft.publishTxDigest,
    soulObjectId: draft.soulObjectId,
    contentBlobId: draft.contentBlobId,
    contentBlobObjectId: draft.contentBlobObjectId,
    sealDekEnvelope: draft.sealDekEnvelope,
    category: draft.category.trim(),
    tags: [...draft.tags],
    previewImages: [draft.previewBlobId],
    readme: draft.readme.trim() || null,
  }
}
