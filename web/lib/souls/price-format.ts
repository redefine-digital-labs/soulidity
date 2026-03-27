const MIST_PER_SUI = 1_000_000_000n
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/

export function serializeAtomicSuiAmount(
  value: { toString(): string } | string | number | bigint | null | undefined,
): string | null {
  if (value == null) {
    return null
  }

  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new Error('Atomic SUI amount bigint must be non-negative')
    }
    return value.toString()
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error('Atomic SUI amount number must be a finite non-negative integer')
    }
    return String(value)
  }

  const serialized = value.toString().trim()
  if (!UNSIGNED_INTEGER_PATTERN.test(serialized)) {
    throw new Error('Atomic SUI amount must be an unsigned integer string')
  }

  return serialized
}

export function parseMistString(value: string): bigint {
  const normalized = serializeAtomicSuiAmount(value)
  if (!normalized) {
    throw new Error('Atomic SUI amount must be an unsigned integer string')
  }
  return BigInt(normalized)
}

export function formatAtomicSuiForDisplay(value: string): string {
  const atomic = parseMistString(value)
  const whole = atomic / MIST_PER_SUI
  const fractional = (atomic % MIST_PER_SUI).toString().padStart(9, '0').replace(/0+$/, '')

  if (!fractional) {
    return `${whole.toString()} SUI`
  }

  return `${whole.toString()}.${fractional} SUI`
}
