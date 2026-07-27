import {
  getSoulidityCallablePackageId,
  getSoulidityAnimacraftProvenancePackageId,
  getSoulidityDeployment,
  getSoulidityMarketConfigV2PackageId,
  getSoulidityOriginalPackageId,
} from './deployment'

export type SoulidityPublicEnvName =
  | 'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID'
  | 'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID'
  | 'NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID'
  /** @deprecated Use an explicit callable/original package env key. */
  | 'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'
  | 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID'
  | 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'
  | 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID'
  | 'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID'
  | 'NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID'
  | 'NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID'
  | 'NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID'
  | 'NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE'

export class MissingSoulidityEnvError extends Error {
  constructor(readonly envName: SoulidityPublicEnvName) {
    super(`Missing required Soulidity env: ${envName}`)
    this.name = 'MissingSoulidityEnvError'
  }
}

function readPublicEnv(name: SoulidityPublicEnvName): string | undefined {
  const envValue = process.env[name]?.trim()
  if (envValue && envValue.length > 0) {
    return envValue
  }

  const deployment = getSoulidityDeployment()
  switch (name) {
    case 'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID':
      return getSoulidityCallablePackageId()
    case 'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID':
      return getSoulidityOriginalPackageId()
    case 'NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID':
      return getSoulidityAnimacraftProvenancePackageId()
    case 'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID':
      return process.env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID?.trim()
        || getSoulidityOriginalPackageId()
    case 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID':
      return deployment.marketConfigId
    case 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID':
      return deployment.marketConfigV2Id
    case 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID':
      return getSoulidityMarketConfigV2PackageId()
    case 'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID':
      return deployment.kioskRegistryId
    case 'NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID':
      return deployment.kindRegistryId
    case 'NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID':
      return deployment.soulTransferPolicyId
    case 'NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID':
      return deployment.collectionTransferPolicyId
    case 'NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE':
      return deployment.paymentCoinType
  }
}

export function getOptionalSoulidityEnv(name: SoulidityPublicEnvName): string | null {
  const value = readPublicEnv(name)?.trim()
  return value && value.length > 0 ? value : null
}

export function getRequiredSoulidityEnv(name: SoulidityPublicEnvName): string {
  const value = getOptionalSoulidityEnv(name)
  if (!value) {
    throw new MissingSoulidityEnvError(name)
  }

  return value
}
