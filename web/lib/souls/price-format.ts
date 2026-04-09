const DEFAULT_PAYMENT_DECIMALS = 6
const DEFAULT_PAYMENT_SYMBOL = 'USDC'
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/

export function serializeAtomicAmount(
  value: { toString(): string } | string | number | bigint | null | undefined,
): string | null {
  if (value == null) {
    return null
  }

  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new Error('Atomic amount bigint must be non-negative')
    }
    return value.toString()
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error('Atomic amount number must be a finite non-negative integer')
    }
    return String(value)
  }

  const serialized = value.toString().trim()
  if (!UNSIGNED_INTEGER_PATTERN.test(serialized)) {
    throw new Error('Atomic amount must be an unsigned integer string')
  }

  return serialized
}

export function parseAtomicAmountString(value: string): bigint {
  const normalized = serializeAtomicAmount(value)
  if (!normalized) {
    throw new Error('Atomic amount must be an unsigned integer string')
  }
  return BigInt(normalized)
}

export function formatAtomicAmountForDisplay(
  value: string,
  options: { decimals?: number; symbol?: string } = {},
): string {
  const decimals = options.decimals ?? DEFAULT_PAYMENT_DECIMALS
  const symbol = options.symbol ?? DEFAULT_PAYMENT_SYMBOL
  const atomic = parseAtomicAmountString(value)
  const unitsPerWhole = 10n ** BigInt(decimals)
  const whole = atomic / unitsPerWhole
  const fractional = (atomic % unitsPerWhole).toString().padStart(decimals, '0').replace(/0+$/, '')

  if (!fractional) {
    return `${whole.toString()} ${symbol}`
  }

  return `${whole.toString()}.${fractional} ${symbol}`
}

export function formatAtomicSoulPaymentForDisplay(value: string): string {
  return formatAtomicAmountForDisplay(value, {
    decimals: DEFAULT_PAYMENT_DECIMALS,
    symbol: DEFAULT_PAYMENT_SYMBOL,
  })
}
