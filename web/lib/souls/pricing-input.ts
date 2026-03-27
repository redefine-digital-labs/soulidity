const MIST_PER_SUI = 1_000_000_000n
const MIN_PRICE_MIST = 1_000_000n
const SUI_PRICE_PATTERN = /^(0|[1-9]\d*)(\.\d{1,9})?$/

export function parseSuiPriceToMist(value: string): bigint | null {
  const trimmed = value.trim()
  if (!SUI_PRICE_PATTERN.test(trimmed)) {
    return null
  }

  const [wholePart, fractionalPart = ''] = trimmed.split('.')
  const whole = BigInt(wholePart)
  const fractional = BigInt(fractionalPart.padEnd(9, '0'))
  const atomic = whole * MIST_PER_SUI + fractional

  return atomic >= MIN_PRICE_MIST ? atomic : null
}
