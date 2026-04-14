import { getSoulidityDeployment } from './deployment'

export type SoulidityPublicEnvName =
  | 'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'
  | 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID'
  | 'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID'
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
  const deployment = getSoulidityDeployment()
  switch (name) {
    case 'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID':
      return deployment.packageId
    case 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID':
      return deployment.marketConfigId
    case 'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID':
      return deployment.kioskRegistryId
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
