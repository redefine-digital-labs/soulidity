'use client'

export const SOULIDITY_DEPLOYMENT_SIGNATURE_KEY = 'soulidity-deployment-signature'

export const SOULIDITY_SESSION_KEYS = [
  'soul-publish-result',
  'soul-mint-recovery',
  'soul-import-result',
  'soul-import-recovery',
  'collection-publish-result',
  'collection-mint-recovery',
  'soul-wrap-personal-recovery',
] as const

export interface SoulidityDeploymentScopedState {
  deploymentSignature: string
}

export function getSoulidityDeploymentSignature() {
  return [
    process.env.NEXT_PUBLIC_SUI_NETWORK?.trim().toLowerCase() || 'unknown-network',
    process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID?.trim().toLowerCase() || 'missing-package',
    process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID?.trim().toLowerCase() || 'missing-market',
    process.env.NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID?.trim().toLowerCase() || 'missing-soul-policy',
    process.env.NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID?.trim().toLowerCase() || 'missing-collection-policy',
  ].join('|')
}

export function attachSoulidityDeploymentSignature<T extends object>(payload: T): T & SoulidityDeploymentScopedState {
  return {
    ...payload,
    deploymentSignature: getSoulidityDeploymentSignature(),
  }
}

export function hasCurrentSoulidityDeploymentSignature<T extends object>(
  value: T | null | undefined,
): value is T & SoulidityDeploymentScopedState {
  if (!value || typeof value !== 'object') {
    return false
  }

  return (value as Partial<SoulidityDeploymentScopedState>).deploymentSignature === getSoulidityDeploymentSignature()
}

export function clearSouliditySessionState(storage: Pick<Storage, 'removeItem'>) {
  for (const key of SOULIDITY_SESSION_KEYS) {
    storage.removeItem(key)
  }
}

export function syncSoulidityDeploymentSession(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const currentSignature = getSoulidityDeploymentSignature()
  const previousSignature = storage.getItem(SOULIDITY_DEPLOYMENT_SIGNATURE_KEY)
  const changed = !!previousSignature && previousSignature !== currentSignature

  if (changed) {
    clearSouliditySessionState(storage)
  }

  storage.setItem(SOULIDITY_DEPLOYMENT_SIGNATURE_KEY, currentSignature)
  return { changed, currentSignature }
}
