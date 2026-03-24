import { normalizeSuiAddress } from '@mysten/sui/utils'

export const SOUL_PUBLISH_DRAFT_STORAGE_KEY = 'soul-publish-draft'

const SOUL_PUBLISH_DRAFT_VERSION = 1 as const

export type SoulPublishPricingType = 'onetime' | 'subscription' | 'both'

export type SoulPublishDraft = {
  version: typeof SOUL_PUBLISH_DRAFT_VERSION
  walletAddress: string
  name: string
  description: string
  category: string
  tags: string[]
  pricingType: SoulPublishPricingType
  oneTimePrice: string
  subPrice: string
  subPeriodDays: string
  previewBlobId: string | null
  previewFileKey: string | null
  createTxDigest: string | null
  seriesId: string | null
  authorCapId: string | null
  oneTimePlanTxDigest: string | null
  oneTimePlanId: string | null
  subPlanTxDigest: string | null
  subPlanId: string | null
  releaseId: string | null
  releaseTxDigest: string | null
  dbMirroredAt: string | null
  updatedAt: string
}

export type SoulPublishDraftPatch = Partial<
  Omit<SoulPublishDraft, 'version' | 'walletAddress' | 'updatedAt'>
>

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
  pricingType: SoulPublishPricingType
  oneTimePrice: string
  subPrice: string
  subPeriodDays: string
}

function nowIso() {
  return new Date().toISOString()
}

function getWalletScopedDraftStorageKey(walletAddress: string): string {
  return `${SOUL_PUBLISH_DRAFT_STORAGE_KEY}:${normalizeDraftWalletAddress(walletAddress)}`
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isPricingType(value: unknown): value is SoulPublishPricingType {
  return value === 'onetime' || value === 'subscription' || value === 'both'
}

export function createSoulPublishDraft(input: SoulPublishDraftInput): SoulPublishDraft {
  return {
    version: SOUL_PUBLISH_DRAFT_VERSION,
    walletAddress: input.walletAddress,
    name: input.name,
    description: input.description,
    category: input.category,
    tags: input.tags,
    pricingType: input.pricingType,
    oneTimePrice: input.oneTimePrice,
    subPrice: input.subPrice,
    subPeriodDays: input.subPeriodDays,
    previewBlobId: null,
    previewFileKey: null,
    createTxDigest: null,
    seriesId: null,
    authorCapId: null,
    oneTimePlanTxDigest: null,
    oneTimePlanId: null,
    subPlanTxDigest: null,
    subPlanId: null,
    releaseId: null,
    releaseTxDigest: null,
    dbMirroredAt: null,
    updatedAt: nowIso(),
  }
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
      || !isPricingType(parsed.pricingType)
      || typeof parsed.oneTimePrice !== 'string'
      || typeof parsed.subPrice !== 'string'
      || typeof parsed.subPeriodDays !== 'string'
      || !isNullableString(parsed.previewBlobId)
      || !isNullableString(parsed.previewFileKey)
      || !isNullableString(parsed.createTxDigest)
      || !isNullableString(parsed.seriesId)
      || !isNullableString(parsed.authorCapId)
      || !isNullableString(parsed.oneTimePlanTxDigest)
      || !isNullableString(parsed.oneTimePlanId)
      || !isNullableString(parsed.subPlanTxDigest)
      || !isNullableString(parsed.subPlanId)
      || !isNullableString(parsed.dbMirroredAt)
      || typeof parsed.updatedAt !== 'string'
    ) {
      return null
    }

    // Backfill fields added after the initial draft version
    if (!('releaseId' in parsed)) {
      ;(parsed as Record<string, unknown>).releaseId = null
    }
    if (!('releaseTxDigest' in parsed)) {
      ;(parsed as Record<string, unknown>).releaseTxDigest = null
    }

    return parsed as SoulPublishDraft
  } catch {
    return null
  }
}

export function readSoulPublishDraft(
  storage: StorageLike,
  walletAddress: string,
): SoulPublishDraft | null {
  const walletKey = getWalletScopedDraftStorageKey(walletAddress)
  const draft = parseSoulPublishDraft(storage.getItem(walletKey))
  const normalizedWalletAddress = normalizeDraftWalletAddress(walletAddress)
  if (
    draft
    && normalizeDraftWalletAddress(draft.walletAddress) === normalizedWalletAddress
  ) {
    return draft.dbMirroredAt ? null : draft
  }

  const legacyDraft = parseSoulPublishDraft(storage.getItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY))
  if (
    !legacyDraft
    || normalizeDraftWalletAddress(legacyDraft.walletAddress) !== normalizedWalletAddress
    || legacyDraft.dbMirroredAt
  ) {
    return null
  }

  if (storage.getItem(walletKey) == null) {
    storage.setItem(walletKey, JSON.stringify(legacyDraft))
  }
  storage.removeItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY)
  return legacyDraft
}

export function writeSoulPublishDraft(storage: StorageLike, draft: SoulPublishDraft) {
  storage.setItem(getWalletScopedDraftStorageKey(draft.walletAddress), JSON.stringify(draft))
  storage.removeItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY)
}

export function clearSoulPublishDraft(storage: StorageLike, walletAddress?: string) {
  if (walletAddress) {
    storage.removeItem(getWalletScopedDraftStorageKey(walletAddress))
    const legacyDraft = parseSoulPublishDraft(storage.getItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY))
    if (
      legacyDraft
      && normalizeDraftWalletAddress(legacyDraft.walletAddress) === normalizeDraftWalletAddress(walletAddress)
    ) {
      storage.removeItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY)
    }
    return
  }
  storage.removeItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY)
}

export function draftHasOnChainProgress(draft: SoulPublishDraft | null) {
  return Boolean(draft?.seriesId || draft?.oneTimePlanId || draft?.subPlanId || draft?.releaseId)
}
