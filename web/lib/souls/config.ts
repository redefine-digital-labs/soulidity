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

// Next.js only replaces process.env.NEXT_PUBLIC_* with literal property access
// at compile time. Dynamic access like process.env[name] does not work on the
// client side. Read each value via literal access so the compiler can inline it.
function readPublicEnv(name: RequiredPublicEnvName): string | undefined {
  switch (name) {
    case 'NEXT_PUBLIC_SOUL_PACKAGE_ID':
      return process.env.NEXT_PUBLIC_SOUL_PACKAGE_ID
    case 'NEXT_PUBLIC_PLATFORM_CONFIG_ID':
      return process.env.NEXT_PUBLIC_PLATFORM_CONFIG_ID
    case 'NEXT_PUBLIC_USDC_COIN_TYPE':
      return process.env.NEXT_PUBLIC_USDC_COIN_TYPE
  }
}

export function getRequiredPublicEnv(name: RequiredPublicEnvName): string {
  const value = readPublicEnv(name)?.trim()
  if (!value) {
    throw new MissingPublicEnvError(name)
  }

  return value
}
