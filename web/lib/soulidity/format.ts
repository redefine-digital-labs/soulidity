const DEFAULT_PAYMENT_DECIMALS = 6
const DEFAULT_PAYMENT_SYMBOL = 'USDC'

export function formatAtomicAmountForDisplay(
  value: string | number | bigint | null | undefined,
  options: { decimals?: number; symbol?: string } = {},
) {
  if (value == null) {
    return `0 ${options.symbol ?? DEFAULT_PAYMENT_SYMBOL}`
  }

  const atomic = BigInt(value)
  const decimals = options.decimals ?? DEFAULT_PAYMENT_DECIMALS
  const symbol = options.symbol ?? DEFAULT_PAYMENT_SYMBOL
  const unitsPerWhole = 10n ** BigInt(decimals)
  const whole = atomic / unitsPerWhole
  const fractional = (atomic % unitsPerWhole).toString().padStart(decimals, '0').replace(/0+$/, '')

  return fractional ? `${whole.toString()}.${fractional} ${symbol}` : `${whole.toString()} ${symbol}`
}

export function parseDisplayAmountToAtomic(
  value: string,
  options: { decimals?: number } = {},
) {
  const decimals = options.decimals ?? DEFAULT_PAYMENT_DECIMALS
  const trimmed = value.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Amount must be a positive number')
  }

  const [wholePart, fractionalPart = ''] = trimmed.split('.')
  if (fractionalPart.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places`)
  }

  const normalized = `${wholePart}${fractionalPart.padEnd(decimals, '0')}`
  return BigInt(normalized)
}
