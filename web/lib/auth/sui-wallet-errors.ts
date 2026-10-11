export function isMultipleSuiWalletBindingsError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'MultipleSuiWalletBindingsError'
}
