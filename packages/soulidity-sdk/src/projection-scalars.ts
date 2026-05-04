const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
// Postgres INT4 upper bound. Prisma `Int` stores at most 2^31 - 1.
const MAX_PRISMA_INT = 2_147_483_647n

export function toProjectionBigInt(value: number | bigint, fieldName: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new Error(`${fieldName} must not be negative`)
    }
    return value
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} is outside the supported integer range`)
  }
  return BigInt(value)
}

export function toProjectionNumber(value: number | bigint, fieldName: string): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${fieldName} exceeds the supported JSON-safe integer range`)
    }
    return value
  }
  if (value < 0n || value > MAX_SAFE_BIGINT) {
    throw new Error(`${fieldName} exceeds the supported JSON-safe integer range`)
  }
  return Number(value)
}

// Fail-closed range check for fields mirrored into Prisma `Int` columns
// (`@db.Integer` / 32-bit signed). Used by mirror writers to reject any
// on-chain value that would silently truncate when persisted.
//
// IMPORTANT: do NOT clamp. If a future on-chain SoulCollection.current_supply
// exceeds 2^31-1, the right move is to migrate the column to BigInt and lift
// the limit, not to truncate.
export function assertBigIntFitsPrismaInt(value: bigint, fieldName: string): void {
  if (value < 0n || value > MAX_PRISMA_INT) {
    throw new Error(
      `${fieldName} (${value.toString()}) is outside the Prisma Int range (0..${MAX_PRISMA_INT.toString()})`,
    )
  }
}
