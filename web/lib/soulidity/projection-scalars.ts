const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

export function toProjectionBigInt(value: number, fieldName: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} is outside the supported integer range`)
  }
  return BigInt(value)
}

export function toProjectionNumber(value: bigint, fieldName: string): number {
  if (value < 0n || value > MAX_SAFE_BIGINT) {
    throw new Error(`${fieldName} exceeds the supported JSON-safe integer range`)
  }
  return Number(value)
}
