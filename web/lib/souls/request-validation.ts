import { isValidTransactionDigest, isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

const MAX_TX_DIGEST_LENGTH = 64
const MAX_SUI_OBJECT_ID_LENGTH = 66

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseNormalizedSuiAddress(value: string): string | null {
  try {
    const normalizedSuiAddress = normalizeSuiAddress(value)
    return isValidSuiAddress(normalizedSuiAddress) ? normalizedSuiAddress : null
  } catch {
    return null
  }
}

export function parseRequiredTxDigest(value: unknown): string | null {
  const digest = parseNonEmptyString(value)
  if (!digest || digest.length > MAX_TX_DIGEST_LENGTH || !isValidTransactionDigest(digest)) {
    return null
  }

  return digest
}

export function parseOptionalTxDigest(value: unknown): string | null {
  if (value == null) {
    return null
  }

  return parseRequiredTxDigest(value)
}

export function parseRequiredObjectId(value: unknown): string | null {
  const objectId = parseNonEmptyString(value)
  if (!objectId || objectId.length > MAX_SUI_OBJECT_ID_LENGTH) {
    return null
  }

  return parseNormalizedSuiAddress(objectId)
}

export function parseOptionalObjectId(value: unknown): string | null {
  if (value == null) {
    return null
  }

  return parseRequiredObjectId(value)
}

export function parseRequiredAddress(value: unknown): string | null {
  return parseRequiredObjectId(value)
}
