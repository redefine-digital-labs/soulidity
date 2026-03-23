export type RequiredPublicEnvName =
  | 'NEXT_PUBLIC_SOUL_PACKAGE_ID'
  | 'NEXT_PUBLIC_PLATFORM_CONFIG_ID'
  | 'NEXT_PUBLIC_USDC_COIN_TYPE'

export class MissingPublicEnvError extends Error {
  constructor(readonly envName: RequiredPublicEnvName) {
    super('Service temporarily unavailable')
    this.name = 'MissingPublicEnvError'
  }
}

export function getRequiredPublicEnv(name: RequiredPublicEnvName): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new MissingPublicEnvError(name)
  }

  return value
}
