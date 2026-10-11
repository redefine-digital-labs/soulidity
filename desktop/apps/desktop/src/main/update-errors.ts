import type { PetUpdateStatus } from '@soulidity/shared'

export function toUpdateErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function isMissingLatestReleaseAssetError(err: unknown): boolean {
  const message = toUpdateErrorMessage(err)
  if (!/\b404\b/.test(message)) {
    return false
  }

  return /latest-mac\.yml|releases\.atom/i.test(message)
}

export function buildUpdateErrorStatus(err: unknown, version?: string): PetUpdateStatus {
  if (isMissingLatestReleaseAssetError(err)) {
    return { state: 'not-available' }
  }

  return {
    state: 'error',
    version,
    error: toUpdateErrorMessage(err),
  }
}
