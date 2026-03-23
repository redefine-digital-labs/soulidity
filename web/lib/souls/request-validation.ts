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

  try {
    const normalizedObjectId = normalizeSuiAddress(objectId)
    return isValidSuiAddress(normalizedObjectId) ? normalizedObjectId : null
  } catch {
    return null
  }
}

export function parseOptionalObjectId(value: unknown): string | null {
  if (value == null) {
    return null
  }

  return parseRequiredObjectId(value)
}
