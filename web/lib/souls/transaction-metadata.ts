import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

type TransactionWithSender = {
  transaction?: {
    data?: {
      sender?: unknown
    }
  } | null
}

export function readNormalizedSuiValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  try {
    const normalized = normalizeSuiAddress(trimmed)
    return isValidSuiAddress(normalized) ? normalized : null
  } catch {
    return null
  }
}

export function readTransactionSender(transaction: TransactionWithSender | null | undefined): string | null {
  return readNormalizedSuiValue(transaction?.transaction?.data?.sender)
}
