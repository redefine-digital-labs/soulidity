const ATOMIC_USDC_SCALE = 1_000_000n
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/

export function serializeAtomicUsdcAmount(
  value: { toString(): string } | string | number | bigint | null | undefined,
): string | null {
  if (value == null) {
    return null
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error('Atomic USDC amount number must be a finite non-negative integer')
    }
    return String(value)
  }

  const serialized = value.toString().trim()
  if (!UNSIGNED_INTEGER_PATTERN.test(serialized)) {
    throw new Error('Atomic USDC amount must be an unsigned integer string')
  }

  return serialized
}

export function parseAtomicUsdcString(value: string): bigint {
  const normalized = serializeAtomicUsdcAmount(value)
  if (!normalized) {
    throw new Error('Atomic USDC amount must be an unsigned integer string')
  }
  return BigInt(normalized)
}

export function formatAtomicUsdcForDisplay(value: string): string {
  const atomic = parseAtomicUsdcString(value)
  const whole = atomic / ATOMIC_USDC_SCALE
  const fractional = (atomic % ATOMIC_USDC_SCALE).toString().padStart(6, '0')

  if (fractional === '000000') {
    return `$${whole.toString()}.00`
  }

  const trimmed = fractional.replace(/0+$/, '')
  const displayFraction = trimmed.length >= 2 ? trimmed : trimmed.padEnd(2, '0')
  return `$${whole.toString()}.${displayFraction}`
}
