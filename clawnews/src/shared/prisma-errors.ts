export type UniqueConstraintError = {
  code: 'P2002'
  meta?: {
    target?: string[] | string
  }
}

export function isUniqueConstraintError(error: unknown): error is UniqueConstraintError {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  )
}

const TRANSIENT_PRISMA_ERROR_CODES = new Set(['P1017'])
const TRANSIENT_DRIVER_ERROR_CODES = new Set([
  '08001',
  '08003',
  '08006',
  '57P01',
  'ECONNRESET',
  'ConnectionClosed',
])

function collectErrorDetails(
  error: unknown,
  seen = new Set<unknown>(),
): { codes: Set<string>; messages: string[] } {
  const codes = new Set<string>()
  const messages: string[] = []

  function visit(value: unknown): void {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)

    const record = value as Record<string, unknown>

    const code = typeof record.code === 'string' ? record.code : undefined
    if (code) codes.add(code)

    const message = typeof record.message === 'string' ? record.message : undefined
    if (message) messages.push(message)

    const kind = typeof record.kind === 'string' ? record.kind : undefined
    if (kind) codes.add(kind)

    visit(record.cause)
    visit(record.meta)
    visit(record.driverAdapterError)
    visit(record.originalError)
  }

  visit(error)
  return { codes, messages }
}

export function getPrismaConnectionErrorCode(error: unknown): string | null {
  const { codes } = collectErrorDetails(error)

  for (const code of codes) {
    if (TRANSIENT_PRISMA_ERROR_CODES.has(code) || TRANSIENT_DRIVER_ERROR_CODES.has(code)) {
      return code
    }
  }

  return null
}

export function isTransientPrismaConnectionError(error: unknown): boolean {
  const { codes, messages } = collectErrorDetails(error)

  for (const code of codes) {
    if (TRANSIENT_PRISMA_ERROR_CODES.has(code) || TRANSIENT_DRIVER_ERROR_CODES.has(code)) {
      return true
    }
  }

  return messages.some((message) => /server has closed the connection|connection closed|connection terminated unexpectedly/i.test(message))
}
