const USDC_ATOMIC_MULTIPLIER = 1_000_000n
const MIN_PRICE_ATOMIC = 10_000n
const MS_PER_DAY = 86_400_000n
const USD_PRICE_PATTERN = /^(0|[1-9]\d*)(\.\d{1,6})?$/
const INTEGER_PATTERN = /^(0|[1-9]\d*)$/

export function parseUsdPriceToAtomic(value: string): bigint | null {
  const trimmed = value.trim()
  if (!USD_PRICE_PATTERN.test(trimmed)) {
    return null
  }

  const [wholePart, fractionalPart = ''] = trimmed.split('.')
  const whole = BigInt(wholePart)
  const fractional = BigInt(fractionalPart.padEnd(6, '0'))
  const atomic = whole * USDC_ATOMIC_MULTIPLIER + fractional

  return atomic >= MIN_PRICE_ATOMIC ? atomic : null
}

export function parseSubscriptionPeriodDaysToMs(value: string): bigint | null {
  const trimmed = value.trim()
  if (!INTEGER_PATTERN.test(trimmed)) {
    return null
  }

  const days = BigInt(trimmed)
  if (days <= 0n) {
    return null
  }

  return days * MS_PER_DAY
}
