import { normalizeSuiAddress } from '@mysten/sui/utils'

const SAFE_RASTER_DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|gif|webp)(?:;|,)/i
const SOUL_ALLOWLIST_CAP_TYPE_SUFFIX = '::allowlist::SoulAllowlistCap'
const MAX_SAFE_DATA_IMAGE_URL_LENGTH = 64 * 1024

function normalizePackageId(value: string | null | undefined) {
  if (!value) {
    return null
  }
  try {
    return normalizeSuiAddress(value.trim())
  } catch {
    return null
  }
}

export function extractCreatedAllowlistCapObjectId(
  result: { objectChanges?: Array<Record<string, unknown>> | null },
  soulObjectPackageId: string | null | undefined,
) {
  const normalizedPackageId = normalizePackageId(soulObjectPackageId)
  if (!normalizedPackageId) {
    return null
  }

  const expectedObjectType = `${normalizedPackageId}${SOUL_ALLOWLIST_CAP_TYPE_SUFFIX}`
  const exactMatch = result.objectChanges?.find((change) => (
    change?.type === 'created'
    && typeof change.objectId === 'string'
    && typeof change.objectType === 'string'
    && change.objectType === expectedObjectType
  ))?.objectId
  if (exactMatch) {
    return exactMatch
  }

  return result.objectChanges?.find((change) => (
    change?.type === 'created'
    && typeof change.objectId === 'string'
    && typeof change.objectType === 'string'
    && change.objectType.endsWith(SOUL_ALLOWLIST_CAP_TYPE_SUFFIX)
  ))?.objectId ?? null
}

export function toSafeBackgroundImage(value: string | null) {
  if (!value) {
    return null
  }

  if (value.startsWith('data:image/')) {
    if (
      value.length > MAX_SAFE_DATA_IMAGE_URL_LENGTH
      || !SAFE_RASTER_DATA_IMAGE_PATTERN.test(value)
      || /[()"\\\r\n]/.test(value)
    ) {
      return null
    }
    return `url("${value}")`
  }

  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') {
      return null
    }
    const urlString = url.toString()
    if (/[()"\\\r\n]/.test(urlString)) {
      return null
    }
    return `url("${urlString}")`
  } catch {
    return null
  }
}
