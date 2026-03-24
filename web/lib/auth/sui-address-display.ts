export function formatSuiAddressDisplay(address: string | null | undefined): string | null {
  const normalized = address?.trim()
  if (!normalized) {
    return null
  }

  if (normalized.length <= 12) {
    return normalized
  }

  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`
}
