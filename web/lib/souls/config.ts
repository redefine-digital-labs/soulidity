export type RequiredPublicEnvName =
  | 'NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID'
  | 'NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID'
  | 'NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID'
  | 'NEXT_PUBLIC_SOUL_MINT_CAP_ID'
  | 'NEXT_PUBLIC_SOUL_COLLECTION_ID'
  | 'NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID'
  | 'NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID'
  | 'NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE'

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
    case 'NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID':
      return process.env.NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID
    case 'NEXT_PUBLIC_SOUL_MINT_CAP_ID':
      return process.env.NEXT_PUBLIC_SOUL_MINT_CAP_ID
    case 'NEXT_PUBLIC_SOUL_COLLECTION_ID':
      return process.env.NEXT_PUBLIC_SOUL_COLLECTION_ID
    case 'NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID':
      return process.env.NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID
    case 'NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID':
      return process.env.NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID
    case 'NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE':
      return process.env.NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE
  }
}

export function getOptionalPublicEnv(name: RequiredPublicEnvName): string | null {
  const value = readPublicEnv(name)?.trim()
  return value || null
}

export function getRequiredPublicEnv(name: RequiredPublicEnvName): string {
  const value = getOptionalPublicEnv(name)
  if (!value) {
    throw new MissingPublicEnvError(name)
  }

  return value
}
