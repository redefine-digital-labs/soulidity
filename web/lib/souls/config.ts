export type RequiredPublicEnvName =
  | 'NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID'
  | 'NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID'
  | 'NEXT_PUBLIC_SOUL_CPU_MARKETPLACE_ID'
  | 'NEXT_PUBLIC_SOUL_UNFT_COLLECTION_ID'
  | 'NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID'

export class MissingPublicEnvError extends Error {
  constructor(readonly envName: RequiredPublicEnvName) {
    super('Service temporarily unavailable')
    this.name = 'MissingPublicEnvError'
  }
}

function readPublicEnv(name: RequiredPublicEnvName): string | undefined {
  switch (name) {
    case 'NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID':
      return process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID
    case 'NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID':
      return process.env.NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID
    case 'NEXT_PUBLIC_SOUL_CPU_MARKETPLACE_ID':
      return process.env.NEXT_PUBLIC_SOUL_CPU_MARKETPLACE_ID
    case 'NEXT_PUBLIC_SOUL_UNFT_COLLECTION_ID':
      return process.env.NEXT_PUBLIC_SOUL_UNFT_COLLECTION_ID
    case 'NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID':
      return process.env.NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID
  }
}

export function getRequiredPublicEnv(name: RequiredPublicEnvName): string {
  const value = readPublicEnv(name)?.trim()
  if (!value) {
    throw new MissingPublicEnvError(name)
  }

  return value
}
