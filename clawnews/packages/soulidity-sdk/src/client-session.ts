'use client'

import { getConfiguredSoulidityNetwork, getSoulidityDeployment } from './deployment'

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
  const deployment = getSoulidityDeployment()
  return [
    getConfiguredSoulidityNetwork(),
    deployment.packageId.trim().toLowerCase(),
    deployment.marketConfigId.trim().toLowerCase(),
    deployment.soulTransferPolicyId.trim().toLowerCase(),
    deployment.collectionTransferPolicyId.trim().toLowerCase(),
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
