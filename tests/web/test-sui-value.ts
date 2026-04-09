// Keep this helper aligned with web/lib/souls/on-chain-verification.ts
// without importing that module into tests that fully mock it.
function normalizeTestSuiValue(value: string): string | null {
  const trimmed = value.trim()
  const hex = trimmed.startsWith('0x') || trimmed.startsWith('0X')
    ? trimmed.slice(2)
    : trimmed

  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    return null
  }

  if (hex.length > 64) {
    return null
  }

  return `0x${hex.toLowerCase().padStart(64, '0')}`
}

export function sameSuiValueForTests(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return false
  const normalizedLeft = normalizeTestSuiValue(left)
  const normalizedRight = normalizeTestSuiValue(right)
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}
