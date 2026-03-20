export function parseSuiTimestampMs(rawValue: string, fieldName: string): Date {
  const timestampMs = Number(rawValue)
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    throw new Error(`Invalid ${fieldName} timestamp: ${rawValue}`)
  }

  return new Date(timestampMs)
}

export function requireSuiPackageId(packageId: string): string {
  if (!packageId) {
    throw new Error('NEXT_PUBLIC_SOUL_PACKAGE_ID is required for the Soul indexer')
  }

  return packageId
}
