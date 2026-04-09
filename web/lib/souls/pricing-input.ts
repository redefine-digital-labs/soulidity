const SOUL_PAYMENT_ATOMIC_PER_UNIT = 1_000_000n
const MIN_SOUL_PAYMENT_ATOMIC = 1_000n
const SOUL_PAYMENT_PRICE_PATTERN = /^(0|[1-9]\d*)(\.\d{1,6})?$/

export function parseSoulPaymentAmountToAtomic(value: string): bigint | null {
  const trimmed = value.trim()
  if (!SOUL_PAYMENT_PRICE_PATTERN.test(trimmed)) {
    return null
  }

  const [wholePart, fractionalPart = ''] = trimmed.split('.')
  const whole = BigInt(wholePart)
  const fractional = BigInt(fractionalPart.padEnd(6, '0'))
  const atomic = whole * SOUL_PAYMENT_ATOMIC_PER_UNIT + fractional

  return atomic >= MIN_SOUL_PAYMENT_ATOMIC ? atomic : null
}
