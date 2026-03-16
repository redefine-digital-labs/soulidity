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
