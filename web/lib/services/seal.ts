/**
 * Seal access control integration.
 * Provides session parameters for client-side decryption.
 */

const SEAL_PACKAGE_ID = process.env.NEXT_PUBLIC_SEAL_PACKAGE_ID || ''
const SOUL_PACKAGE_ID = process.env.NEXT_PUBLIC_SOUL_PACKAGE_ID || ''

export interface SealSessionParams {
  packageId: string
  soulPackageId: string
  policyObjectId: string
  moduleName: string
  functionName: string
}

export function hasSealSessionConfig(): boolean {
  return SEAL_PACKAGE_ID.length > 0 && SOUL_PACKAGE_ID.length > 0
}

/**
 * Get Seal session parameters for a perpetual pass holder.
 */
export function getSealSessionPerpetual(seriesOnChainId: string): SealSessionParams {
  return {
    packageId: SEAL_PACKAGE_ID,
    soulPackageId: SOUL_PACKAGE_ID,
    policyObjectId: seriesOnChainId,
    moduleName: 'seal_policy',
    functionName: 'seal_approve_perpetual',
  }
}

/**
 * Get Seal session parameters for a subscription pass holder.
 */
export function getSealSessionSubscription(seriesOnChainId: string): SealSessionParams {
  return {
    packageId: SEAL_PACKAGE_ID,
    soulPackageId: SOUL_PACKAGE_ID,
    policyObjectId: seriesOnChainId,
    moduleName: 'seal_policy',
    functionName: 'seal_approve_subscription',
  }
}
